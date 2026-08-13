"use server";

import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

export type DriverOperationEvent = {
  id: string;
  driverId: string;
  driverName: string;
  driverCode: string;
  category: string;
  operationKey: string;
  source: string;
  sourceName: string | null;
  success: boolean;
  errorCode: string | null;
  entityType: string | null;
  entityId: string | null;
  context: Record<string, unknown>;
  latitude: number | null;
  longitude: number | null;
  deviceId: string | null;
  appVersionCode: number | null;
  occurredAt: string;
};

/** `occurred_at desc, id desc` — matches the composite indexes on the table. */
export type OperationFeedCursor = {
  occurredAt: string;
  id: string;
};

export type OperationFeedPage = {
  events: DriverOperationEvent[];
  nextCursor: OperationFeedCursor | null;
};

export type OperationFeedFilters = {
  driverId?: string | null;
  categories?: string[] | null;
  failuresOnly?: boolean;
  from?: string | null;
  to?: string | null;
  cursor?: OperationFeedCursor | null;
  limit?: number;
};

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

async function requireOpsView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "driver_ops.view", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

const SELECT_COLUMNS = `
  id,
  driver_id,
  category,
  operation_key,
  source,
  source_name,
  success,
  error_code,
  entity_type,
  entity_id,
  context,
  latitude,
  longitude,
  device_id,
  app_version_code,
  occurred_at,
  drivers ( driver_code, profiles ( full_name ) )
`;

type RawEventRow = {
  id: number | string;
  driver_id: string;
  category: string;
  operation_key: string;
  source: string;
  source_name: string | null;
  success: boolean;
  error_code: string | null;
  entity_type: string | null;
  entity_id: string | null;
  context: Record<string, unknown> | null;
  latitude: number | string | null;
  longitude: number | string | null;
  device_id: string | null;
  app_version_code: number | null;
  occurred_at: string;
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

function mapEventRow(row: RawEventRow): DriverOperationEvent {
  const driver = Array.isArray(row.drivers) ? row.drivers[0] : row.drivers;
  const profile = Array.isArray(driver?.profiles) ? driver?.profiles[0] : driver?.profiles;
  const driverCode = driver?.driver_code ?? "—";

  return {
    id: String(row.id),
    driverId: row.driver_id,
    driverName: profile?.full_name?.trim() || driverCode,
    driverCode,
    category: row.category,
    operationKey: row.operation_key,
    source: row.source,
    sourceName: row.source_name,
    success: row.success,
    errorCode: row.error_code,
    entityType: row.entity_type,
    entityId: row.entity_id,
    context: row.context ?? {},
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    deviceId: row.device_id,
    appVersionCode: row.app_version_code,
    occurredAt: row.occurred_at,
  };
}

/**
 * Keyset pagination rather than range/offset: the feed is append-heavy, so an
 * offset page would both skip and repeat rows as new events land while an
 * operator reads.
 */
export async function fetchDriverOperationFeed(
  filters: OperationFeedFilters = {},
): Promise<OperationFeedPage> {
  await requireOpsView();
  const supabase = await createClient();

  const limit = Math.min(Math.max(filters.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  let query = supabase
    .from("driver_operation_events")
    .select(SELECT_COLUMNS)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (filters.driverId) query = query.eq("driver_id", filters.driverId);
  if (filters.categories?.length) query = query.in("category", filters.categories);
  if (filters.failuresOnly) query = query.eq("success", false);
  if (filters.from) query = query.gte("occurred_at", filters.from);
  if (filters.to) query = query.lte("occurred_at", filters.to);

  if (filters.cursor) {
    // The timestamp is passed through verbatim (microseconds included) and
    // double-quoted: it carries a space and a `+` offset, which PostgREST would
    // otherwise read as filter syntax. Rounding it to ISO milliseconds instead
    // would silently skip rows inside the same millisecond.
    const occurredAt = `"${filters.cursor.occurredAt.replace(/"/g, "")}"`;
    const id = filters.cursor.id;
    query = query.or(
      `occurred_at.lt.${occurredAt},and(occurred_at.eq.${occurredAt},id.lt.${id})`,
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as RawEventRow[];
  const hasMore = rows.length > limit;
  const events = rows.slice(0, limit).map(mapEventRow);
  const last = events.at(-1);

  void logAdminRead("driver_operation_events", "driverOps.fetchFeed", {
    driverId: filters.driverId ?? null,
    categories: filters.categories ?? null,
    failuresOnly: filters.failuresOnly ?? false,
  });

  return {
    events,
    nextCursor:
      hasMore && last ? { occurredAt: last.occurredAt, id: last.id } : null,
  };
}

/** Driver popup + detail timeline — newest first, no pagination. */
export async function fetchDriverOperationTimeline(
  driverId: string,
  limit = 20,
): Promise<DriverOperationEvent[]> {
  await requireOpsView();
  if (!driverId) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("driver_operation_events")
    .select(SELECT_COLUMNS)
    .eq("driver_id", driverId)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), MAX_LIMIT));

  if (error) throw new Error(error.message);

  void logAdminRead("driver_operation_events", "driverOps.fetchTimeline", { driverId });

  return ((data ?? []) as unknown as RawEventRow[]).map(mapEventRow);
}

export type OperationCategoryCount = {
  category: string;
  total: number;
  failures: number;
};

/**
 * KPI tiles. Counted client-side over a capped window instead of a GROUP BY RPC:
 * PostgREST cannot aggregate, and the tiles only ever summarise the same slice
 * the feed is showing.
 */
export async function fetchOperationCategoryCounts(range: {
  from: string;
  to?: string | null;
  driverId?: string | null;
}): Promise<OperationCategoryCount[]> {
  await requireOpsView();
  const supabase = await createClient();

  let query = supabase
    .from("driver_operation_events")
    .select("category, success")
    .gte("occurred_at", range.from)
    .order("occurred_at", { ascending: false })
    .limit(10000);

  if (range.to) query = query.lte("occurred_at", range.to);
  if (range.driverId) query = query.eq("driver_id", range.driverId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const byCategory = new Map<string, OperationCategoryCount>();
  for (const row of (data ?? []) as Array<{ category: string; success: boolean }>) {
    const entry = byCategory.get(row.category) ?? {
      category: row.category,
      total: 0,
      failures: 0,
    };
    entry.total += 1;
    if (!row.success) entry.failures += 1;
    byCategory.set(row.category, entry);
  }

  return [...byCategory.values()].sort((a, b) => b.total - a.total);
}

const EXPORT_MAX_ROWS = 5000;

/**
 * Export needs its own slug: the rows carry request payload context and failed
 * login attempts, so reading them in the UI and taking them out of the panel are
 * different privileges.
 */
export async function exportDriverOperations(filters: {
  driverId?: string | null;
  categories?: string[] | null;
  failuresOnly?: boolean;
  from?: string | null;
  to?: string | null;
}): Promise<DriverOperationEvent[]> {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "driver_ops.export", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }

  const supabase = await createClient();
  let query = supabase
    .from("driver_operation_events")
    .select(SELECT_COLUMNS)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(EXPORT_MAX_ROWS);

  if (filters.driverId) query = query.eq("driver_id", filters.driverId);
  if (filters.categories?.length) query = query.in("category", filters.categories);
  if (filters.failuresOnly) query = query.eq("success", false);
  if (filters.from) query = query.gte("occurred_at", filters.from);
  if (filters.to) query = query.lte("occurred_at", filters.to);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const events = ((data ?? []) as unknown as RawEventRow[]).map(mapEventRow);

  void logAdminMutation({
    action: "export",
    entityType: "driver_operation_events",
    entityId: filters.driverId ?? undefined,
    routeName: "driverOps.export",
    context: {
      rows: events.length,
      truncated: events.length === EXPORT_MAX_ROWS,
      from: filters.from ?? null,
      to: filters.to ?? null,
      failuresOnly: filters.failuresOnly ?? false,
    },
  });

  return events;
}
