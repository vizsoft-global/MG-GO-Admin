"use server";

import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

export type DriverTelemetryEvent = {
  id: string;
  driverId: string;
  driverName: string;
  driverCode: string;
  eventName: string;
  category: string;
  severity: string;
  clientTs: string;
  serverReceivedAt: string;
  clockSkewMs: number | null;
  sessionId: string | null;
  correlationId: string | null;
  platform: string | null;
  appVersionName: string | null;
  appVersionCode: number | null;
  deviceId: string | null;
  networkState: string | null;
  context: Record<string, unknown>;
  contextStrippedKeys: number;
};

/** `client_ts desc, id desc` — matches the composite indexes on the table. */
export type TelemetryFeedCursor = {
  clientTs: string;
  id: string;
};

export type TelemetryFeedPage = {
  events: DriverTelemetryEvent[];
  nextCursor: TelemetryFeedCursor | null;
};

export type TelemetryFeedFilters = {
  driverId?: string | null;
  categories?: string[] | null;
  errorsOnly?: boolean;
  from?: string | null;
  to?: string | null;
  cursor?: TelemetryFeedCursor | null;
  limit?: number;
};

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
const EXPORT_MAX_ROWS = 5000;
const COUNT_WINDOW_ROWS = 10000;

async function requireTelemetryView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(
      session.permissions,
      "driver_telemetry.view",
      session.isSuperAdmin,
    )
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

const SELECT_COLUMNS = `
  id,
  driver_id,
  event_name,
  category,
  severity,
  client_ts,
  server_received_at,
  clock_skew_ms,
  session_id,
  correlation_id,
  platform,
  app_version_name,
  app_version_code,
  device_id,
  network_state,
  context,
  context_stripped_keys,
  drivers ( driver_code, profiles ( full_name ) )
`;

type RawTelemetryRow = {
  id: number | string;
  driver_id: string;
  event_name: string;
  category: string;
  severity: string;
  client_ts: string;
  server_received_at: string;
  clock_skew_ms: number | null;
  session_id: string | null;
  correlation_id: string | null;
  platform: string | null;
  app_version_name: string | null;
  app_version_code: number | null;
  device_id: string | null;
  network_state: string | null;
  context: Record<string, unknown> | null;
  context_stripped_keys: number | null;
  drivers:
    | {
        driver_code: string | null;
        profiles: { full_name: string | null } | { full_name: string | null }[] | null;
      }
    | Array<{
        driver_code: string | null;
        profiles: { full_name: string | null } | { full_name: string | null }[] | null;
      }>
    | null;
};

function mapRow(row: RawTelemetryRow): DriverTelemetryEvent {
  const driver = Array.isArray(row.drivers) ? row.drivers[0] : row.drivers;
  const profile = Array.isArray(driver?.profiles) ? driver?.profiles[0] : driver?.profiles;
  const driverCode = driver?.driver_code ?? "—";

  return {
    id: String(row.id),
    driverId: row.driver_id,
    driverName: profile?.full_name?.trim() || driverCode,
    driverCode,
    eventName: row.event_name,
    category: row.category,
    severity: row.severity,
    clientTs: row.client_ts,
    serverReceivedAt: row.server_received_at,
    clockSkewMs: row.clock_skew_ms,
    sessionId: row.session_id,
    correlationId: row.correlation_id,
    platform: row.platform,
    appVersionName: row.app_version_name,
    appVersionCode: row.app_version_code,
    deviceId: row.device_id,
    networkState: row.network_state,
    context: row.context ?? {},
    contextStrippedKeys: row.context_stripped_keys ?? 0,
  };
}

/**
 * Ordered by `client_ts`, not `server_received_at`: the point of the diagnostics
 * timeline is when things happened on the phone. A batch that was queued offline
 * for ten minutes must still land in the right place in the sequence.
 */
export async function fetchTelemetryFeed(
  filters: TelemetryFeedFilters = {},
): Promise<TelemetryFeedPage> {
  await requireTelemetryView();
  const supabase = await createClient();

  const limit = Math.min(Math.max(filters.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  let query = supabase
    .from("driver_telemetry_events")
    .select(SELECT_COLUMNS)
    .order("client_ts", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (filters.driverId) query = query.eq("driver_id", filters.driverId);
  if (filters.categories?.length) query = query.in("category", filters.categories);
  if (filters.errorsOnly) query = query.eq("severity", "error");
  if (filters.from) query = query.gte("client_ts", filters.from);
  if (filters.to) query = query.lte("client_ts", filters.to);

  if (filters.cursor) {
    // Same quoting rule as the operations feed: the timestamp carries a space
    // and a `+` offset, which PostgREST would otherwise read as filter syntax.
    const clientTs = `"${filters.cursor.clientTs.replace(/"/g, "")}"`;
    query = query.or(
      `client_ts.lt.${clientTs},and(client_ts.eq.${clientTs},id.lt.${filters.cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as RawTelemetryRow[];
  const hasMore = rows.length > limit;
  const events = rows.slice(0, limit).map(mapRow);
  const last = events.at(-1);

  void logAdminRead("driver_telemetry_events", "driverTelemetry.fetchFeed", {
    driverId: filters.driverId ?? null,
    categories: filters.categories ?? null,
    errorsOnly: filters.errorsOnly ?? false,
  });

  return {
    events,
    nextCursor: hasMore && last ? { clientTs: last.clientTs, id: last.id } : null,
  };
}

export type TelemetryCategoryCount = {
  category: string;
  total: number;
  errors: number;
};

export type TelemetrySummary = {
  categories: TelemetryCategoryCount[];
  total: number;
  errors: number;
  /** Largest absolute device clock offset seen in the window, in ms. */
  maxClockSkewMs: number;
  offlineTransitions: number;
};

/**
 * KPI tiles. Counted client-side over a capped window for the same reason as the
 * operations feed: PostgREST cannot aggregate, and the tiles only summarise the
 * slice the feed is already showing.
 */
export async function fetchTelemetrySummary(range: {
  from: string;
  to?: string | null;
  driverId?: string | null;
}): Promise<TelemetrySummary> {
  await requireTelemetryView();
  const supabase = await createClient();

  let query = supabase
    .from("driver_telemetry_events")
    .select("category, severity, event_name, clock_skew_ms")
    .gte("client_ts", range.from)
    .order("client_ts", { ascending: false })
    .limit(COUNT_WINDOW_ROWS);

  if (range.to) query = query.lte("client_ts", range.to);
  if (range.driverId) query = query.eq("driver_id", range.driverId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{
    category: string;
    severity: string;
    event_name: string;
    clock_skew_ms: number | null;
  }>;

  const byCategory = new Map<string, TelemetryCategoryCount>();
  let total = 0;
  let errors = 0;
  let maxClockSkewMs = 0;
  let offlineTransitions = 0;

  for (const row of rows) {
    const entry = byCategory.get(row.category) ?? {
      category: row.category,
      total: 0,
      errors: 0,
    };
    entry.total += 1;
    total += 1;
    if (row.severity === "error") {
      entry.errors += 1;
      errors += 1;
    }
    byCategory.set(row.category, entry);

    const skew = Math.abs(row.clock_skew_ms ?? 0);
    if (skew > maxClockSkewMs) maxClockSkewMs = skew;
    if (row.event_name === "network.offline") offlineTransitions += 1;
  }

  return {
    categories: [...byCategory.values()].sort((a, b) => b.total - a.total),
    total,
    errors,
    maxClockSkewMs,
    offlineTransitions,
  };
}

/**
 * Export has its own slug for the same reason as `driver_ops.export`: reading
 * diagnostics inside the panel and taking a device-level trace out of it are
 * different privileges.
 */
export async function exportTelemetryEvents(filters: {
  driverId?: string | null;
  categories?: string[] | null;
  errorsOnly?: boolean;
  from?: string | null;
  to?: string | null;
}): Promise<DriverTelemetryEvent[]> {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(
      session.permissions,
      "driver_telemetry.export",
      session.isSuperAdmin,
    )
  ) {
    throw new Error("not_authorized");
  }

  const supabase = await createClient();
  let query = supabase
    .from("driver_telemetry_events")
    .select(SELECT_COLUMNS)
    .order("client_ts", { ascending: false })
    .order("id", { ascending: false })
    .limit(EXPORT_MAX_ROWS);

  if (filters.driverId) query = query.eq("driver_id", filters.driverId);
  if (filters.categories?.length) query = query.in("category", filters.categories);
  if (filters.errorsOnly) query = query.eq("severity", "error");
  if (filters.from) query = query.gte("client_ts", filters.from);
  if (filters.to) query = query.lte("client_ts", filters.to);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const events = ((data ?? []) as unknown as RawTelemetryRow[]).map(mapRow);

  void logAdminMutation({
    action: "export",
    entityType: "driver_telemetry_events",
    entityId: filters.driverId ?? undefined,
    routeName: "driverTelemetry.export",
    context: {
      rows: events.length,
      truncated: events.length === EXPORT_MAX_ROWS,
      from: filters.from ?? null,
      to: filters.to ?? null,
      errorsOnly: filters.errorsOnly ?? false,
    },
  });

  return events;
}
