"use server";

import { getSessionUser } from "@/lib/auth/get-session";
import {
  fetchMetric,
  monitoringContext,
  type MetricResult,
  type MonitoringContext,
} from "@/lib/usage/cloud-monitoring";

import { functionShape, windowTotal, type UsagePoint } from "./usage-forecast";

/**
 * Usage monitor read. Super admin only.
 *
 * Everything here comes from Cloud Monitoring — no Firestore read, no audit row —
 * because the page exists to watch the bill and must not add to it.
 */

export type UsageLine = {
  points: UsagePoint[];
  /** The metric that answered, so the page can say what it is showing. */
  source: string | null;
  error: string | null;
};

export type UsageFunctionRow = {
  name: string;
  h1: number;
  h5: number;
  h24: number;
};

export type UsageOverview = {
  generatedAt: number;
  /** End of the measured window. Metrics trail real time by a few minutes. */
  endMs: number;
  projectId: string;
  serviceAccountEmail: string;
  reads: UsageLine;
  writes: UsageLine;
  deletes: UsageLine;
  ttlDeletes: UsageLine;
  /** Enterprise edition bills units, not documents. Empty on Standard. */
  billedReadUnits: UsageLine;
  billedWriteUnits: UsageLine;
  invocations: UsageLine;
  vcpuSeconds: UsageLine;
  gibSeconds: UsageLine;
  functions: UsageFunctionRow[];
  functionCount: number;
};

export type UsageOverviewResult = UsageOverview | { error: string; serviceAccountEmail?: string };

const FINE_SECONDS = 300;
const HOUR_SECONDS = 3_600;
const DAY_MS = 24 * 3_600_000;
/** Cloud Monitoring publishes Firestore counters up to four minutes late. */
const METRIC_LAG_MS = 5 * 60_000;
const CACHE_MS = 60_000;
const TOP_FUNCTIONS = 25;

let cached: { at: number; value: UsageOverview } | null = null;

function errorCode(result: Extract<MetricResult, { ok: false }>): string {
  if (result.status === 403) return "permission_denied";
  if (result.status === 401) return "token_failed";
  return "monitoring_failed";
}

function totalOf(result: Extract<MetricResult, { ok: true }>): UsagePoint[] {
  const byTime = new Map<number, number>();
  for (const series of result.series) {
    for (const point of series.points) {
      byTime.set(point.t, (byTime.get(point.t) ?? 0) + point.v);
    }
  }
  return [...byTime.entries()].map(([t, v]) => ({ t, v })).sort((a, b) => a.t - b.t);
}

/**
 * The first metric that has data wins. The per-database `*_ops_count` counters
 * are the current ones; the `*_count` names are the older instance-level
 * counters, kept as a fallback for a project that only publishes those.
 */
async function firstWithData(
  context: MonitoringContext,
  metricTypes: readonly string[],
  window: { startMs: number; endMs: number },
): Promise<UsageLine> {
  let lastError: string | null = null;
  let answered: string | null = null;
  for (const metricType of metricTypes) {
    const result = await fetchMetric(context, {
      metricType,
      startMs: window.startMs,
      endMs: window.endMs,
      alignSeconds: FINE_SECONDS,
    });
    if (!result.ok) {
      lastError = errorCode(result);
      continue;
    }
    answered = answered ?? metricType;
    const points = totalOf(result);
    if (points.length > 0) return { points, source: metricType, error: null };
  }
  // Answered but empty is a real zero, not a failure.
  if (answered) return { points: [], source: answered, error: null };
  return { points: [], source: null, error: lastError ?? "monitoring_failed" };
}

async function sumOf(
  context: MonitoringContext,
  metricTypes: readonly string[],
  window: { startMs: number; endMs: number },
): Promise<UsageLine> {
  const results = await Promise.all(
    metricTypes.map((metricType) =>
      fetchMetric(context, {
        metricType,
        startMs: window.startMs,
        endMs: window.endMs,
        alignSeconds: FINE_SECONDS,
      }),
    ),
  );
  const byTime = new Map<number, number>();
  let error: string | null = null;
  let any = false;
  for (const result of results) {
    if (!result.ok) {
      error = error ?? errorCode(result);
      continue;
    }
    any = true;
    for (const point of totalOf(result)) byTime.set(point.t, (byTime.get(point.t) ?? 0) + point.v);
  }
  const points = [...byTime.entries()].map(([t, v]) => ({ t, v })).sort((a, b) => a.t - b.t);
  return { points, source: any ? metricTypes[0]! : null, error: any ? null : error };
}

export async function getUsageOverview(force = false): Promise<UsageOverviewResult> {
  const session = await getSessionUser();
  if (!session?.isSuperAdmin) return { error: "not_authorized" };

  const now = Date.now();
  if (!force && cached && now - cached.at < CACHE_MS) return cached.value;

  const context = await monitoringContext();
  if ("error" in context) return { error: context.error };

  // A window that ends on a five-minute boundary tiles exactly into both the
  // five-minute and the hourly buckets, so "the last hour" is whole buckets.
  const fineMs = FINE_SECONDS * 1_000;
  const endMs = Math.floor((now - METRIC_LAG_MS) / fineMs) * fineMs;
  const window = { startMs: endMs - DAY_MS, endMs };
  const fs = "firestore.googleapis.com";

  const [reads, writes, deletes, ttlDeletes, billedReadUnits, billedWriteUnits, calls, instance] =
    await Promise.all([
      firstWithData(context, [`${fs}/document/read_ops_count`, `${fs}/document/read_count`], window),
      firstWithData(context, [`${fs}/document/write_ops_count`, `${fs}/document/write_count`], window),
      firstWithData(
        context,
        [`${fs}/document/delete_ops_count`, `${fs}/document/delete_count`],
        window,
      ),
      firstWithData(context, [`${fs}/document/ttl_deletion_count`], window),
      sumOf(
        context,
        [`${fs}/api/billable_read_units`, `${fs}/api/billable_realtime_read_units`],
        window,
      ),
      sumOf(context, [`${fs}/api/billable_write_units`], window),
      fetchMetric(context, {
        metricType: "run.googleapis.com/request_count",
        resourceType: "cloud_run_revision",
        groupBy: "resource.label.service_name",
        alignSeconds: HOUR_SECONDS,
        ...window,
      }),
      fetchMetric(context, {
        metricType: "run.googleapis.com/container/billable_instance_time",
        resourceType: "cloud_run_revision",
        groupBy: "resource.label.service_name",
        alignSeconds: HOUR_SECONDS,
        ...window,
      }),
    ]);

  const firstError = [reads, writes, deletes].find((line) => line.error)?.error ?? null;
  if (firstError && reads.error && writes.error && deletes.error) {
    // Nothing answered at all: almost always the service account lacks the role.
    return { error: firstError, serviceAccountEmail: context.serviceAccountEmail };
  }

  let invocations: UsageLine = { points: [], source: null, error: null };
  let functions: UsageFunctionRow[] = [];
  let functionCount = 0;
  if (calls.ok) {
    invocations = {
      points: totalOf(calls),
      source: "run.googleapis.com/request_count",
      error: null,
    };
    functionCount = calls.series.length;
    functions = calls.series
      .map((series) => ({
        name: series.key,
        h1: windowTotal(series.points, endMs, 1),
        h5: windowTotal(series.points, endMs, 5),
        h24: windowTotal(series.points, endMs, 24),
      }))
      .filter((row) => row.h24 > 0)
      .sort((a, b) => b.h24 - a.h24)
      .slice(0, TOP_FUNCTIONS);
  } else {
    invocations = { points: [], source: null, error: errorCode(calls) };
  }

  let vcpuSeconds: UsageLine = { points: [], source: null, error: null };
  let gibSeconds: UsageLine = { points: [], source: null, error: null };
  if (instance.ok) {
    const vcpu = new Map<number, number>();
    const gib = new Map<number, number>();
    for (const series of instance.series) {
      const shape = functionShape(series.key);
      for (const point of series.points) {
        vcpu.set(point.t, (vcpu.get(point.t) ?? 0) + point.v * shape.cpu);
        gib.set(point.t, (gib.get(point.t) ?? 0) + point.v * shape.memGib);
      }
    }
    const toPoints = (map: Map<number, number>) =>
      [...map.entries()].map(([t, v]) => ({ t, v })).sort((a, b) => a.t - b.t);
    const source = "run.googleapis.com/container/billable_instance_time";
    vcpuSeconds = { points: toPoints(vcpu), source, error: null };
    gibSeconds = { points: toPoints(gib), source, error: null };
  } else {
    const error = errorCode(instance);
    vcpuSeconds = { points: [], source: null, error };
    gibSeconds = { points: [], source: null, error };
  }

  const value: UsageOverview = {
    generatedAt: now,
    endMs,
    projectId: context.projectId,
    serviceAccountEmail: context.serviceAccountEmail,
    reads,
    writes,
    deletes,
    ttlDeletes,
    billedReadUnits,
    billedWriteUnits,
    invocations,
    vcpuSeconds,
    gibSeconds,
    functions,
    functionCount,
  };
  cached = { at: now, value };
  return value;
}
