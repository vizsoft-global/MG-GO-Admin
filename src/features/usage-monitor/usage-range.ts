import "server-only";

import {
  cloudflareContext,
  cloudflarePoster,
  queryCloudflareDataset,
  type CloudflarePost,
} from "@/lib/usage/cloudflare-analytics";
import { fetchMetric, monitoringContext, type MetricResult } from "@/lib/usage/cloud-monitoring";

import {
  EMPTY_CLOUDFLARE_USAGE,
  classifyR2Action,
  type CloudflareWindowUsage,
} from "./cloudflare-forecast";
import { functionShape } from "./usage-forecast";

/**
 * Usage for one time range, for the standalone monitor.
 *
 * The settings page reads a fixed 24 hours. The monitor asks for anything from
 * the last hour in five-minute buckets to six weeks in hourly ones, which is as
 * far back as Cloud Monitoring keeps these counters. Nothing here reads
 * Firestore.
 */

export const USAGE_RANGES = {
  "1h": { hours: 1, bucketSeconds: 300 },
  "6h": { hours: 6, bucketSeconds: 300 },
  "24h": { hours: 24, bucketSeconds: 300 },
  "7d": { hours: 168, bucketSeconds: 3_600 },
  "30d": { hours: 720, bucketSeconds: 3_600 },
  "42d": { hours: 1_008, bucketSeconds: 3_600 },
} as const;

export type UsageRangeKey = keyof typeof USAGE_RANGES;

export function isUsageRangeKey(value: string | null): value is UsageRangeKey {
  return value !== null && Object.prototype.hasOwnProperty.call(USAGE_RANGES, value);
}

/** `[bucket end ms, value]`, oldest first. Compact because a range can be 1,000 points. */
export type SeriesPoint = [number, number];

export type FirebaseRange = {
  reads: SeriesPoint[];
  writes: SeriesPoint[];
  deletes: SeriesPoint[];
  ttlDeletes: SeriesPoint[];
  billedReadUnits: SeriesPoint[];
  billedWriteUnits: SeriesPoint[];
  invocations: SeriesPoint[];
  /** Compute over the whole range, already multiplied by each function's size. */
  vcpuSeconds: number;
  gibSeconds: number;
  functions: Array<{ name: string; calls: number }>;
  functionCount: number;
  errors: string[];
};

export type CloudflareRange = {
  totals: CloudflareWindowUsage;
  storageBytes: number | null;
  storageObjects: number | null;
  scripts: Array<{ name: string; requests: number }>;
  workerRequests: SeriesPoint[];
  workerBucketSeconds: number | null;
  unknown: string[];
  approximate: string[];
  failed: Array<{ dataset: string; message: string }>;
};

export type UsageRangePayload = {
  range: UsageRangeKey;
  bucketSeconds: number;
  startMs: number;
  endMs: number;
  generatedAt: number;
  firebase: FirebaseRange | { error: string };
  cloudflare: CloudflareRange | { error: string };
};

const HOUR_MS = 3_600_000;
/** Both platforms publish a few minutes late; asking for "now" returns a hole. */
const LAG_MS = 5 * 60_000;
const CACHE_MS = 60_000;
const TOP_FUNCTIONS = 30;
const TOP_SCRIPTS = 12;

const cache = new Map<UsageRangeKey, { at: number; value: UsageRangePayload }>();

function points(result: Extract<MetricResult, { ok: true }>): SeriesPoint[] {
  const byTime = new Map<number, number>();
  for (const series of result.series) {
    for (const point of series.points) byTime.set(point.t, (byTime.get(point.t) ?? 0) + point.v);
  }
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]);
}

function failure(result: Extract<MetricResult, { ok: false }>): string {
  if (result.status === 403) return "permission_denied";
  if (result.status === 401) return "token_failed";
  return "monitoring_failed";
}

async function loadFirebase(window: {
  startMs: number;
  endMs: number;
  bucketSeconds: number;
}): Promise<FirebaseRange | { error: string }> {
  const context = await monitoringContext();
  if ("error" in context) return { error: context.error };

  const fs = "firestore.googleapis.com";
  const errors: string[] = [];
  const base = { startMs: window.startMs, endMs: window.endMs, alignSeconds: window.bucketSeconds };
  const whole = Math.round((window.endMs - window.startMs) / 1_000);

  /** The per-database counter first, the older instance-level one as a fallback. */
  const line = async (name: string, metricTypes: readonly string[]): Promise<SeriesPoint[]> => {
    let lastError: string | null = null;
    let answered = false;
    for (const metricType of metricTypes) {
      const result = await fetchMetric(context, { metricType, ...base });
      if (!result.ok) {
        lastError = failure(result);
        continue;
      }
      answered = true;
      const series = points(result);
      if (series.length > 0) return series;
    }
    if (!answered) errors.push(`${name}:${lastError ?? "monitoring_failed"}`);
    return [];
  };

  const sum = async (name: string, metricTypes: readonly string[]): Promise<SeriesPoint[]> => {
    const byTime = new Map<number, number>();
    let any = false;
    for (const metricType of metricTypes) {
      const result = await fetchMetric(context, { metricType, ...base });
      if (!result.ok) continue;
      any = true;
      for (const [t, v] of points(result)) byTime.set(t, (byTime.get(t) ?? 0) + v);
    }
    if (!any) errors.push(`${name}:monitoring_failed`);
    return [...byTime.entries()].sort((a, b) => a[0] - b[0]);
  };

  const run = "run.googleapis.com";
  const [reads, writes, deletes, ttlDeletes, billedReadUnits, billedWriteUnits, calls, perFunction, instance] =
    await Promise.all([
      line("reads", [`${fs}/document/read_ops_count`, `${fs}/document/read_count`]),
      line("writes", [`${fs}/document/write_ops_count`, `${fs}/document/write_count`]),
      line("deletes", [`${fs}/document/delete_ops_count`, `${fs}/document/delete_count`]),
      line("ttlDeletes", [`${fs}/document/ttl_deletion_count`]),
      sum("billedReadUnits", [
        `${fs}/api/billable_read_units`,
        `${fs}/api/billable_realtime_read_units`,
      ]),
      sum("billedWriteUnits", [`${fs}/api/billable_write_units`]),
      // One series for the whole project: cheap at any bucket size.
      fetchMetric(context, {
        metricType: `${run}/request_count`,
        resourceType: "cloud_run_revision",
        ...base,
      }),
      // Per function, the range as a single bucket: 300 functions times a
      // thousand buckets would be a response nobody needs.
      fetchMetric(context, {
        metricType: `${run}/request_count`,
        resourceType: "cloud_run_revision",
        groupBy: "resource.label.service_name",
        startMs: window.startMs,
        endMs: window.endMs,
        alignSeconds: whole,
      }),
      fetchMetric(context, {
        metricType: `${run}/container/billable_instance_time`,
        resourceType: "cloud_run_revision",
        groupBy: "resource.label.service_name",
        startMs: window.startMs,
        endMs: window.endMs,
        alignSeconds: whole,
      }),
    ]);

  // Enterprise-only metrics answer "no data" on Standard; that is not an error.
  const real = errors.filter(
    (entry) => !entry.startsWith("billedReadUnits") && !entry.startsWith("billedWriteUnits"),
  );
  if (real.length >= 3 && reads.length === 0 && writes.length === 0) {
    return { error: real[0]!.split(":")[1] ?? "monitoring_failed" };
  }

  let functions: FirebaseRange["functions"] = [];
  let functionCount = 0;
  if (perFunction.ok) {
    functionCount = perFunction.series.length;
    functions = perFunction.series
      .map((series) => ({
        name: series.key,
        calls: series.points.reduce((total, point) => total + point.v, 0),
      }))
      .filter((row) => row.calls > 0)
      .sort((a, b) => b.calls - a.calls)
      .slice(0, TOP_FUNCTIONS);
  } else {
    real.push(`functions:${failure(perFunction)}`);
  }

  let vcpuSeconds = 0;
  let gibSeconds = 0;
  if (instance.ok) {
    for (const series of instance.series) {
      const shape = functionShape(series.key);
      const seconds = series.points.reduce((total, point) => total + point.v, 0);
      vcpuSeconds += seconds * shape.cpu;
      gibSeconds += seconds * shape.memGib;
    }
  } else {
    real.push(`compute:${failure(instance)}`);
  }

  return {
    reads,
    writes,
    deletes,
    ttlDeletes,
    billedReadUnits,
    billedWriteUnits,
    invocations: calls.ok ? points(calls) : [],
    vcpuSeconds,
    gibSeconds,
    functions,
    functionCount,
    errors: real,
  };
}

const WORKERS = "workersInvocationsAdaptive";
const DO_INVOCATIONS = "durableObjectsInvocationsAdaptiveGroups";
const DO_PERIODIC = "durableObjectsPeriodicGroups";
const R2_OPERATIONS = "r2OperationsAdaptiveGroups";
const R2_STORAGE = "r2StorageAdaptiveGroups";

/** Time dimensions to try, finest first, with the bucket each one yields. */
const TIME_DIMENSIONS: ReadonlyArray<{ name: string; seconds: number }> = [
  { name: "datetimeFiveMinutes", seconds: 300 },
  { name: "datetimeFifteenMinutes", seconds: 900 },
  { name: "datetimeHour", seconds: 3_600 },
  { name: "date", seconds: 86_400 },
];

/** The dimension Cloudflare accepted for a given bucket size, remembered. */
const dimensionMemo = new Map<number, string>();

async function workerSeries(
  post: CloudflarePost,
  accountId: string,
  window: { startMs: number; endMs: number; bucketSeconds: number },
): Promise<{ series: SeriesPoint[]; bucketSeconds: number | null }> {
  const remembered = dimensionMemo.get(window.bucketSeconds);
  const candidates = TIME_DIMENSIONS.filter((entry) =>
    remembered ? entry.name === remembered : entry.seconds >= window.bucketSeconds,
  );
  for (const candidate of candidates) {
    const result = await queryCloudflareDataset(post, accountId, {
      dataset: WORKERS,
      sum: ["requests"],
      dimensions: [candidate.name],
      startMs: window.startMs,
      endMs: window.endMs,
    });
    if (!result.ok || result.granularity !== "exact") continue;
    dimensionMemo.set(window.bucketSeconds, candidate.name);
    const byTime = new Map<number, number>();
    for (const row of result.rows) {
      const raw = row.dimensions[candidate.name];
      if (!raw) continue;
      const start = Date.parse(candidate.name === "date" ? `${raw}T00:00:00.000Z` : raw);
      if (!Number.isFinite(start)) continue;
      // Cloudflare labels a bucket by its start; the rest of the page uses the end.
      const t = start + candidate.seconds * 1_000;
      byTime.set(t, (byTime.get(t) ?? 0) + (row.sum.requests ?? 0));
    }
    return { series: [...byTime.entries()].sort((a, b) => a[0] - b[0]), bucketSeconds: candidate.seconds };
  }
  return { series: [], bucketSeconds: null };
}

async function loadCloudflare(window: {
  startMs: number;
  endMs: number;
  bucketSeconds: number;
}): Promise<CloudflareRange | { error: string }> {
  const context = cloudflareContext();
  if ("error" in context) return { error: context.error };
  const post = cloudflarePoster(context);
  const range = { startMs: window.startMs, endMs: window.endMs };

  const [workers, doInvocations, doPeriodic, r2Operations, storage, series] = await Promise.all([
    queryCloudflareDataset(post, context.accountId, {
      dataset: WORKERS,
      sum: ["requests", "subrequests", "errors"],
      optionalSum: ["cpuTimeUs"],
      dimensions: ["scriptName"],
      ...range,
    }),
    queryCloudflareDataset(post, context.accountId, {
      dataset: DO_INVOCATIONS,
      sum: ["requests"],
      ...range,
    }),
    queryCloudflareDataset(post, context.accountId, {
      dataset: DO_PERIODIC,
      sum: ["cpuTime"],
      optionalSum: ["duration", "inboundWebsocketMsgCount", "rowsRead", "rowsWritten"],
      ...range,
    }),
    queryCloudflareDataset(post, context.accountId, {
      dataset: R2_OPERATIONS,
      sum: ["requests"],
      dimensions: ["actionType"],
      ...range,
    }),
    queryCloudflareDataset(post, context.accountId, {
      dataset: R2_STORAGE,
      max: ["payloadSize", "objectCount"],
      dimensions: ["bucketName"],
      startMs: window.endMs - 24 * HOUR_MS,
      endMs: window.endMs,
    }),
    workerSeries(post, context.accountId, window),
  ]);

  const failed: CloudflareRange["failed"] = [];
  const unknown = new Set<string>();
  const approximate: string[] = [];
  const note = (dataset: string, result: { ok: boolean; message?: string; granularity?: string }) => {
    if (!result.ok) failed.push({ dataset, message: result.message ?? "analytics_failed" });
    else if (result.granularity === "day") approximate.push(dataset);
  };
  note(WORKERS, workers);
  note(DO_INVOCATIONS, doInvocations);
  note(DO_PERIODIC, doPeriodic);
  note(R2_OPERATIONS, r2Operations);
  note(R2_STORAGE, storage);

  if (failed.length >= 4) {
    const first = failed[0]?.message ?? "";
    return {
      error: /auth|permission|not authorized|forbidden/i.test(first)
        ? "cloudflare_denied"
        : "cloudflare_failed",
    };
  }

  const totals: CloudflareWindowUsage = { ...EMPTY_CLOUDFLARE_USAGE };
  const scripts = new Map<string, number>();
  const total = (rows: ReadonlyArray<{ sum: Record<string, number> }>, field: string) =>
    rows.reduce((value, row) => value + (row.sum[field] ?? 0), 0);

  if (workers.ok) {
    totals.workerRequests = total(workers.rows, "requests");
    if (workers.missing.includes("cpuTimeUs")) unknown.add("workerCpuMs");
    else totals.workerCpuMs = total(workers.rows, "cpuTimeUs") / 1_000;
    for (const row of workers.rows) {
      const name = row.dimensions.scriptName ?? "unknown";
      scripts.set(name, (scripts.get(name) ?? 0) + (row.sum.requests ?? 0));
    }
  } else {
    unknown.add("workerCpuMs");
  }
  if (doInvocations.ok) totals.doRequests = total(doInvocations.rows, "requests");

  const periodic: Array<[keyof CloudflareWindowUsage, string]> = [
    ["doDurationGbs", "duration"],
    ["doWebsocketMessages", "inboundWebsocketMsgCount"],
    ["doRowsRead", "rowsRead"],
    ["doRowsWritten", "rowsWritten"],
  ];
  for (const [key, field] of periodic) {
    if (!doPeriodic.ok || doPeriodic.missing.includes(field)) unknown.add(key);
    else totals[key] = total(doPeriodic.rows, field);
  }

  if (r2Operations.ok) {
    for (const row of r2Operations.rows) {
      const price = classifyR2Action(row.dimensions.actionType ?? "");
      if (price === "A") totals.r2ClassA += row.sum.requests ?? 0;
      else if (price === "B") totals.r2ClassB += row.sum.requests ?? 0;
    }
  }

  let storageBytes: number | null = null;
  let storageObjects: number | null = null;
  if (storage.ok) {
    const perBucket = new Map<string, { bytes: number; objects: number }>();
    for (const row of storage.rows) {
      const bucket = row.dimensions.bucketName ?? "unknown";
      const entry = perBucket.get(bucket) ?? { bytes: 0, objects: 0 };
      entry.bytes = Math.max(entry.bytes, row.max.payloadSize ?? 0);
      entry.objects = Math.max(entry.objects, row.max.objectCount ?? 0);
      perBucket.set(bucket, entry);
    }
    storageBytes = 0;
    storageObjects = 0;
    for (const entry of perBucket.values()) {
      storageBytes += entry.bytes;
      storageObjects += entry.objects;
    }
  }

  return {
    totals,
    storageBytes,
    storageObjects,
    scripts: [...scripts.entries()]
      .map(([name, requests]) => ({ name, requests }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, TOP_SCRIPTS),
    workerRequests: series.series,
    workerBucketSeconds: series.bucketSeconds,
    unknown: [...unknown],
    approximate,
    failed,
  };
}

/** The window a range covers, ending on a whole bucket a few minutes ago. */
export function rangeWindow(
  range: UsageRangeKey,
  now: number,
): { startMs: number; endMs: number; bucketSeconds: number } {
  const { hours, bucketSeconds } = USAGE_RANGES[range];
  const bucketMs = bucketSeconds * 1_000;
  const endMs = Math.floor((now - LAG_MS) / bucketMs) * bucketMs;
  return { startMs: endMs - hours * HOUR_MS, endMs, bucketSeconds };
}

export async function loadUsageRange(range: UsageRangeKey): Promise<UsageRangePayload> {
  const now = Date.now();
  const hit = cache.get(range);
  if (hit && now - hit.at < CACHE_MS) return hit.value;

  const window = rangeWindow(range, now);
  const [firebase, cloudflare] = await Promise.all([loadFirebase(window), loadCloudflare(window)]);
  const value: UsageRangePayload = {
    range,
    bucketSeconds: window.bucketSeconds,
    startMs: window.startMs,
    endMs: window.endMs,
    generatedAt: now,
    firebase,
    cloudflare,
  };
  cache.set(range, { at: now, value });
  return value;
}
