import "server-only";

import { getFirebaseAdminApp } from "@/lib/firebase/admin";
import { resolveFirebaseAdminCredentials } from "@/lib/firebase/credentials";

/**
 * Reads Google Cloud Monitoring time series with the panel's own service account.
 *
 * These are the platform's usage counters — the numbers the bill is built from —
 * so the usage monitor reads them here instead of counting anything itself: a
 * page that measured cost by reading Firestore would be part of the cost.
 * Monitoring API reads of Google's own metrics are not billed.
 */

export type MetricPoint = { t: number; v: number };

export type MetricSeries = { key: string; points: MetricPoint[] };

export type MetricResult =
  | { ok: true; series: MetricSeries[] }
  | { ok: false; status: number; message: string };

export type MonitoringContext = {
  projectId: string;
  serviceAccountEmail: string;
  token: string;
};

type RawPoint = {
  interval?: { endTime?: string };
  value?: { int64Value?: string; doubleValue?: number };
};

type RawSeries = {
  metric?: { labels?: Record<string, string> };
  resource?: { labels?: Record<string, string> };
  points?: RawPoint[];
};

type RawResponse = {
  timeSeries?: RawSeries[];
  nextPageToken?: string;
  error?: { message?: string };
};

const API = "https://monitoring.googleapis.com/v3";
const MAX_PAGES = 20;
const REQUEST_TIMEOUT_MS = 20_000;

export async function monitoringContext(): Promise<MonitoringContext | { error: string }> {
  const credentials = resolveFirebaseAdminCredentials();
  if (!credentials) return { error: "not_configured" };
  const app = await getFirebaseAdminApp();
  const credential = app?.options.credential;
  if (!credential) return { error: "not_configured" };
  try {
    const token = await credential.getAccessToken();
    if (!token?.access_token) return { error: "token_failed" };
    return {
      projectId: credentials.projectId,
      serviceAccountEmail: credentials.clientEmail,
      token: token.access_token,
    };
  } catch {
    return { error: "token_failed" };
  }
}

function labelOf(series: RawSeries, groupBy: string | undefined): string {
  if (!groupBy) return "all";
  // `resource.label.service_name` / `metric.label.type` -> the bare label name.
  const name = groupBy.split(".").pop() ?? groupBy;
  const source = groupBy.startsWith("metric.") ? series.metric?.labels : series.resource?.labels;
  return source?.[name] ?? "unknown";
}

/**
 * One metric, summed into fixed buckets.
 *
 * Every metric this page reads is a DELTA counter, so `ALIGN_SUM` per bucket and
 * `REDUCE_SUM` across series is the count in that bucket — optionally split by one
 * label (a function name, for instance).
 */
export async function fetchMetric(
  context: MonitoringContext,
  args: {
    metricType: string;
    startMs: number;
    endMs: number;
    alignSeconds: number;
    groupBy?: string;
    resourceType?: string;
  },
): Promise<MetricResult> {
  const filter =
    `metric.type="${args.metricType}"` +
    (args.resourceType ? ` AND resource.type="${args.resourceType}"` : "");
  const base = new URLSearchParams({
    filter,
    "interval.startTime": new Date(args.startMs).toISOString(),
    "interval.endTime": new Date(args.endMs).toISOString(),
    "aggregation.alignmentPeriod": `${args.alignSeconds}s`,
    "aggregation.perSeriesAligner": "ALIGN_SUM",
    "aggregation.crossSeriesReducer": "REDUCE_SUM",
  });
  if (args.groupBy) base.append("aggregation.groupByFields", args.groupBy);

  const byKey = new Map<string, Map<number, number>>();
  let pageToken = "";

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams(base);
    if (pageToken) params.set("pageToken", pageToken);

    let response: Response;
    try {
      response = await fetch(`${API}/projects/${context.projectId}/timeSeries?${params}`, {
        headers: { authorization: `Bearer ${context.token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      return { ok: false, status: 0, message: error instanceof Error ? error.message : "fetch_failed" };
    }

    let body: RawResponse;
    try {
      body = (await response.json()) as RawResponse;
    } catch {
      return { ok: false, status: response.status, message: "bad_response" };
    }
    if (!response.ok) {
      return { ok: false, status: response.status, message: body.error?.message ?? "request_failed" };
    }

    for (const series of body.timeSeries ?? []) {
      const key = labelOf(series, args.groupBy);
      const bucket = byKey.get(key) ?? new Map<number, number>();
      for (const point of series.points ?? []) {
        const t = Date.parse(point.interval?.endTime ?? "");
        if (!Number.isFinite(t)) continue;
        const raw = point.value?.int64Value ?? point.value?.doubleValue ?? 0;
        const value = Number(raw);
        if (!Number.isFinite(value)) continue;
        bucket.set(t, (bucket.get(t) ?? 0) + value);
      }
      byKey.set(key, bucket);
    }

    pageToken = body.nextPageToken ?? "";
    if (!pageToken) break;
  }

  const series: MetricSeries[] = [];
  for (const [key, bucket] of byKey) {
    const points = [...bucket.entries()].map(([t, v]) => ({ t, v })).sort((a, b) => a.t - b.t);
    series.push({ key, points });
  }
  return { ok: true, series };
}
