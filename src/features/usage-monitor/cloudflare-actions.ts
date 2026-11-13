"use server";

import { getSessionUser } from "@/lib/auth/get-session";
import {
  cloudflareContext,
  cloudflarePoster,
  queryCloudflareDataset,
  type CloudflarePost,
  type CloudflareResult,
  type CloudflareRow,
} from "@/lib/usage/cloudflare-analytics";

import {
  EMPTY_CLOUDFLARE_USAGE,
  classifyR2Action,
  type CloudflareWindowUsage,
} from "./cloudflare-forecast";
import { USAGE_WINDOWS, type UsageWindowKey } from "./usage-forecast";

/**
 * Cloudflare side of the usage monitor. Super admin only.
 *
 * Reads the account's GraphQL analytics with the same API token the storage
 * page already uses. The figures are for the whole Cloudflare account, which
 * is what the invoice is for.
 */

export type CloudflareScriptRow = { name: string; h1: number; h5: number; h24: number };

export type CloudflareOverview = {
  generatedAt: number;
  endMs: number;
  windows: Record<UsageWindowKey, CloudflareWindowUsage>;
  storageBytes: number | null;
  storageObjects: number | null;
  scripts: CloudflareScriptRow[];
  /** Figures the analytics API would not give; they are left out of the forecast. */
  unknown: string[];
  /** Datasets that could only be read by whole day, so short windows are scaled. */
  approximate: string[];
  /** Datasets that failed outright, with the API's own message. */
  failed: Array<{ dataset: string; message: string }>;
};

export type CloudflareOverviewResult = CloudflareOverview | { error: string };

const HOUR_MS = 3_600_000;
const ANALYTICS_LAG_MS = 2 * 60_000;
const CACHE_MS = 120_000;
const TOP_SCRIPTS = 12;

const WORKERS = "workersInvocationsAdaptive";
const DO_INVOCATIONS = "durableObjectsInvocationsAdaptiveGroups";
const DO_PERIODIC = "durableObjectsPeriodicGroups";
const R2_OPERATIONS = "r2OperationsAdaptiveGroups";
const R2_STORAGE = "r2StorageAdaptiveGroups";

let cached: { at: number; value: CloudflareOverview } | null = null;

function total(rows: readonly CloudflareRow[], field: string): number {
  let sum = 0;
  for (const row of rows) sum += row.sum[field] ?? 0;
  return sum;
}

/**
 * A day-granular answer covers whole UTC days, not the window that was asked
 * for. It is turned into an hourly rate over the hours those days have had so
 * far, then stretched to the window, so a 1h figure is "an average hour today".
 */
function scaleOf(result: Extract<CloudflareResult, { ok: true }>, startMs: number, endMs: number, hours: number): number {
  if (result.granularity === "exact") return 1;
  const dayStart = Date.parse(`${new Date(startMs).toISOString().slice(0, 10)}T00:00:00.000Z`);
  const covered = Math.max(1, (endMs - dayStart) / HOUR_MS);
  return hours / covered;
}

async function readWindow(
  post: CloudflarePost,
  accountId: string,
  endMs: number,
  hours: number,
  notes: { unknown: Set<string>; approximate: Set<string>; failed: Map<string, string> },
): Promise<{ usage: CloudflareWindowUsage; scripts: Map<string, number> }> {
  const window = { startMs: endMs - hours * HOUR_MS, endMs };
  const [workers, doInvocations, doPeriodic, r2Operations] = await Promise.all([
    queryCloudflareDataset(post, accountId, {
      dataset: WORKERS,
      sum: ["requests", "subrequests", "errors"],
      optionalSum: ["cpuTimeUs"],
      dimensions: ["scriptName"],
      ...window,
    }),
    queryCloudflareDataset(post, accountId, {
      dataset: DO_INVOCATIONS,
      sum: ["requests"],
      ...window,
    }),
    queryCloudflareDataset(post, accountId, {
      dataset: DO_PERIODIC,
      sum: ["cpuTime"],
      optionalSum: ["duration", "inboundWebsocketMsgCount", "rowsRead", "rowsWritten"],
      ...window,
    }),
    queryCloudflareDataset(post, accountId, {
      dataset: R2_OPERATIONS,
      sum: ["requests"],
      dimensions: ["actionType"],
      ...window,
    }),
  ]);

  const usage: CloudflareWindowUsage = { ...EMPTY_CLOUDFLARE_USAGE };
  const scripts = new Map<string, number>();
  const note = (dataset: string, result: CloudflareResult) => {
    if (!result.ok) notes.failed.set(dataset, result.message);
    else if (result.granularity === "day") notes.approximate.add(dataset);
  };
  note(WORKERS, workers);
  note(DO_INVOCATIONS, doInvocations);
  note(DO_PERIODIC, doPeriodic);
  note(R2_OPERATIONS, r2Operations);

  if (workers.ok) {
    const scale = scaleOf(workers, window.startMs, endMs, hours);
    usage.workerRequests = total(workers.rows, "requests") * scale;
    if (workers.missing.includes("cpuTimeUs")) notes.unknown.add("workerCpuMs");
    else usage.workerCpuMs = (total(workers.rows, "cpuTimeUs") / 1_000) * scale;
    for (const row of workers.rows) {
      const name = row.dimensions.scriptName ?? "unknown";
      scripts.set(name, (scripts.get(name) ?? 0) + (row.sum.requests ?? 0) * scale);
    }
  } else {
    notes.unknown.add("workerCpuMs");
  }

  if (doInvocations.ok) {
    usage.doRequests =
      total(doInvocations.rows, "requests") *
      scaleOf(doInvocations, window.startMs, endMs, hours);
  }

  const periodicFields: Array<[keyof CloudflareWindowUsage, string]> = [
    ["doDurationGbs", "duration"],
    ["doWebsocketMessages", "inboundWebsocketMsgCount"],
    ["doRowsRead", "rowsRead"],
    ["doRowsWritten", "rowsWritten"],
  ];
  if (doPeriodic.ok) {
    const scale = scaleOf(doPeriodic, window.startMs, endMs, hours);
    for (const [key, field] of periodicFields) {
      if (doPeriodic.missing.includes(field)) notes.unknown.add(key);
      else usage[key] = total(doPeriodic.rows, field) * scale;
    }
  } else {
    for (const [key] of periodicFields) notes.unknown.add(key);
  }

  if (r2Operations.ok) {
    const scale = scaleOf(r2Operations, window.startMs, endMs, hours);
    for (const row of r2Operations.rows) {
      const requests = (row.sum.requests ?? 0) * scale;
      const price = classifyR2Action(row.dimensions.actionType ?? "");
      if (price === "A") usage.r2ClassA += requests;
      else if (price === "B") usage.r2ClassB += requests;
    }
  }

  return { usage, scripts };
}

export async function getCloudflareUsage(force = false): Promise<CloudflareOverviewResult> {
  const session = await getSessionUser();
  if (!session?.isSuperAdmin) return { error: "not_authorized" };

  const now = Date.now();
  if (!force && cached && now - cached.at < CACHE_MS) return cached.value;

  const context = cloudflareContext();
  if ("error" in context) return { error: context.error };
  const post = cloudflarePoster(context);

  const endMs = now - ANALYTICS_LAG_MS;
  const notes = {
    unknown: new Set<string>(),
    approximate: new Set<string>(),
    failed: new Map<string, string>(),
  };

  const [h1, h5, h24, storage] = await Promise.all([
    readWindow(post, context.accountId, endMs, 1, notes),
    readWindow(post, context.accountId, endMs, 5, notes),
    readWindow(post, context.accountId, endMs, 24, notes),
    queryCloudflareDataset(post, context.accountId, {
      dataset: R2_STORAGE,
      max: ["payloadSize", "objectCount"],
      dimensions: ["bucketName"],
      startMs: endMs - 24 * HOUR_MS,
      endMs,
    }),
  ]);

  // Every dataset failing the same way is one problem (a token without
  // Account Analytics: Read, usually), and is clearer said once.
  if (notes.failed.size >= 4) {
    const first = [...notes.failed.values()][0] ?? "analytics_failed";
    return { error: /auth|permission|not authorized|forbidden/i.test(first) ? "cloudflare_denied" : "cloudflare_failed" };
  }

  let storageBytes: number | null = null;
  let storageObjects: number | null = null;
  if (storage.ok) {
    storageBytes = 0;
    storageObjects = 0;
    // One row per bucket and timestamp; a bucket's size is its largest reading.
    const perBucket = new Map<string, { bytes: number; objects: number }>();
    for (const row of storage.rows) {
      const bucket = row.dimensions.bucketName ?? "unknown";
      const entry = perBucket.get(bucket) ?? { bytes: 0, objects: 0 };
      entry.bytes = Math.max(entry.bytes, row.max.payloadSize ?? 0);
      entry.objects = Math.max(entry.objects, row.max.objectCount ?? 0);
      perBucket.set(bucket, entry);
    }
    for (const entry of perBucket.values()) {
      storageBytes += entry.bytes;
      storageObjects += entry.objects;
    }
  } else {
    notes.failed.set(R2_STORAGE, storage.message);
  }

  const names = new Set([...h1.scripts.keys(), ...h5.scripts.keys(), ...h24.scripts.keys()]);
  const scripts = [...names]
    .map((name) => ({
      name,
      h1: h1.scripts.get(name) ?? 0,
      h5: h5.scripts.get(name) ?? 0,
      h24: h24.scripts.get(name) ?? 0,
    }))
    .sort((a, b) => b.h24 - a.h24)
    .slice(0, TOP_SCRIPTS);

  const windows = {} as Record<UsageWindowKey, CloudflareWindowUsage>;
  const byHours = new Map<number, CloudflareWindowUsage>([
    [1, h1.usage],
    [5, h5.usage],
    [24, h24.usage],
  ]);
  for (const { key, hours } of USAGE_WINDOWS) windows[key] = byHours.get(hours)!;

  const value: CloudflareOverview = {
    generatedAt: now,
    endMs,
    windows,
    storageBytes,
    storageObjects,
    scripts,
    unknown: [...notes.unknown],
    approximate: [...notes.approximate],
    failed: [...notes.failed.entries()].map(([dataset, message]) => ({ dataset, message })),
  };
  cached = { at: now, value };
  return value;
}
