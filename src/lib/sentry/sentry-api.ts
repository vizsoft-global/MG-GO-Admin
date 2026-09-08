/**
 * Read-only Sentry Discover reads for the driver app project.
 *
 * Server-only: `SENTRY_API_TOKEN` must never carry the `NEXT_PUBLIC_` prefix — a
 * Sentry auth token in the browser bundle reads every project in the org.
 *
 * Every entry point answers `{ connected: false }` rather than throwing. Sentry
 * is a side channel here: the Driver devices page is built from Supabase and
 * must render its whole table when Sentry is unconfigured, rate-limited or slow,
 * which is also why the timeout is short enough to be invisible next to the
 * Supabase round trip it runs beside.
 */

const SENTRY_HOST = process.env.SENTRY_API_HOST ?? "us.sentry.io";
const SENTRY_ORG = process.env.SENTRY_ORG ?? "vizsoft-global";
const SENTRY_DRIVER_PROJECT =
  process.env.SENTRY_DRIVER_APP_PROJECT ?? "flutter-mussalam";

/** Long enough for a warm Discover query, short enough not to hold the page. */
const REQUEST_TIMEOUT_MS = 4_000;

/** Sentry aggregates over 7d; re-asking more often than this buys nothing. */
const CACHE_TTL_MS = 5 * 60 * 1000;

const DEFAULT_STATS_PERIOD = "7d";

/** Discover caps a page at 100; the fleet is a few hundred drivers. */
const PER_PAGE = 100;

export type SentryBuildStat = {
  /** `dist` is the Android versionCode the Flutter SDK reports. */
  versionCode: number | null;
  release: string | null;
  events: number;
  users: number;
};

export type SentryDriverStat = {
  driverId: string;
  events: number;
  issues: number;
};

export type SentryDeviceOverview =
  | {
      connected: true;
      statsPeriod: string;
      builds: SentryBuildStat[];
      drivers: SentryDriverStat[];
    }
  | {
      connected: false;
      reason: SentryDisconnectedReason;
    };

export type SentryDisconnectedReason =
  | "not_configured"
  | "unauthorized"
  | "timeout"
  | "request_failed";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The driver app binds `SentryUser.id` to the Supabase auth uid, which is
 * `drivers.id`. Sentry stores it verbatim, but a tag value that has been through
 * a search box or an older build can arrive without dashes, so both forms are
 * accepted and one canonical form is returned.
 */
export function sentryUserIdToDriverId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  // Sentry prefixes a scalar user identifier when it was set as `id:<value>`.
  const bare = value.startsWith("id:") ? value.slice(3) : value;
  if (UUID_RE.test(bare)) return bare;
  if (/^[0-9a-f]{32}$/.test(bare)) {
    return [
      bare.slice(0, 8),
      bare.slice(8, 12),
      bare.slice(12, 16),
      bare.slice(16, 20),
      bare.slice(20),
    ].join("-");
  }
  return null;
}

/** The value to put in a `user.id:` Discover query for a given driver. */
export function driverIdToSentryUserId(driverId: string | null | undefined): string | null {
  if (!driverId) return null;
  const value = driverId.trim().toLowerCase();
  return UUID_RE.test(value) ? value : null;
}

function sentryOrgUrl(path: string, params: Record<string, string>): string {
  const search = new URLSearchParams(params).toString();
  return `https://${SENTRY_HOST}/organizations/${SENTRY_ORG}${path}${search ? `?${search}` : ""}`;
}

/** Issue stream filtered to one driver. */
export function sentryDriverIssuesUrl(
  driverId: string,
  statsPeriod: string = DEFAULT_STATS_PERIOD,
): string | null {
  const userId = driverIdToSentryUserId(driverId);
  if (!userId) return null;
  return sentryOrgUrl("/issues/", {
    project: SENTRY_DRIVER_PROJECT,
    query: `user.id:"${userId}"`,
    statsPeriod,
  });
}

/** Issue stream filtered to one build. */
export function sentryBuildIssuesUrl(
  versionCode: number,
  statsPeriod: string = DEFAULT_STATS_PERIOD,
): string {
  return sentryOrgUrl("/issues/", {
    project: SENTRY_DRIVER_PROJECT,
    query: `dist:"${versionCode}"`,
    statsPeriod,
  });
}

export function sentryProjectUrl(): string {
  return `https://${SENTRY_HOST}/organizations/${SENTRY_ORG}/projects/${SENTRY_DRIVER_PROJECT}/`;
}

export function isSentryConfigured(): boolean {
  return Boolean(process.env.SENTRY_API_TOKEN?.trim());
}

type DiscoverRow = Record<string, unknown>;

type CacheEntry = { at: number; value: SentryDeviceOverview };

let cache: CacheEntry | null = null;

/** Test seam — the suite drives the module without a network. */
export function __resetSentryApiCache(): void {
  cache = null;
}

function toInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

async function discover(
  fields: string[],
  extra: Record<string, string>,
): Promise<{ rows: DiscoverRow[] } | { reason: SentryDisconnectedReason }> {
  const token = process.env.SENTRY_API_TOKEN?.trim();
  if (!token) return { reason: "not_configured" };

  const params = new URLSearchParams();
  for (const field of fields) params.append("field", field);
  params.set("project", SENTRY_DRIVER_PROJECT);
  params.set("per_page", String(PER_PAGE));
  params.set("dataset", "errors");
  for (const [key, value] of Object.entries(extra)) params.set(key, value);

  try {
    const response = await fetch(
      `https://${SENTRY_HOST}/api/0/organizations/${SENTRY_ORG}/events/?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      },
    );
    if (response.status === 401 || response.status === 403) {
      return { reason: "unauthorized" };
    }
    if (!response.ok) return { reason: "request_failed" };
    const body = (await response.json()) as { data?: DiscoverRow[] };
    return { rows: Array.isArray(body.data) ? body.data : [] };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return { reason: name === "TimeoutError" ? "timeout" : "request_failed" };
  }
}

/**
 * One 7-day picture of the driver app: error volume per build and per driver.
 *
 * Two queries rather than one grouped by both, because a `dist × user.id`
 * aggregation is one row per driver per build and the page needs the two
 * totals independently — a driver's count must not change when they upgrade
 * mid-window, and a build's count must not be split across its installs.
 */
export async function getSentryDeviceOverview(
  statsPeriod: string = DEFAULT_STATS_PERIOD,
): Promise<SentryDeviceOverview> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  if (!isSentryConfigured()) {
    const value: SentryDeviceOverview = { connected: false, reason: "not_configured" };
    cache = { at: Date.now(), value };
    return value;
  }

  const [buildResult, driverResult] = await Promise.all([
    discover(["dist", "release", "count()", "count_unique(user)"], {
      statsPeriod,
      sort: "-count",
    }),
    discover(["user.id", "count()", "count_unique(issue)"], {
      statsPeriod,
      sort: "-count",
    }),
  ]);

  if ("reason" in buildResult) {
    const value: SentryDeviceOverview = { connected: false, reason: buildResult.reason };
    cache = { at: Date.now(), value };
    return value;
  }
  if ("reason" in driverResult) {
    const value: SentryDeviceOverview = { connected: false, reason: driverResult.reason };
    cache = { at: Date.now(), value };
    return value;
  }

  const builds: SentryBuildStat[] = buildResult.rows.map((row) => {
    const dist = row.dist;
    const parsed = typeof dist === "string" ? Number.parseInt(dist, 10) : NaN;
    return {
      versionCode: Number.isFinite(parsed) ? parsed : null,
      release: typeof row.release === "string" ? row.release : null,
      events: toInt(row["count()"]),
      users: toInt(row["count_unique(user)"]),
    };
  });

  const byDriver = new Map<string, SentryDriverStat>();
  for (const row of driverResult.rows) {
    const driverId = sentryUserIdToDriverId(
      typeof row["user.id"] === "string" ? row["user.id"] : null,
    );
    if (!driverId) continue;
    // Sentry can return the dashed and undashed forms as separate rows when a
    // build changed how it set the id; they are the same rider, so fold them.
    const existing = byDriver.get(driverId);
    const events = toInt(row["count()"]);
    const issues = toInt(row["count_unique(issue)"]);
    if (existing) {
      existing.events += events;
      existing.issues += issues;
    } else {
      byDriver.set(driverId, { driverId, events, issues });
    }
  }

  const value: SentryDeviceOverview = {
    connected: true,
    statsPeriod,
    builds,
    drivers: [...byDriver.values()],
  };
  cache = { at: Date.now(), value };
  return value;
}
