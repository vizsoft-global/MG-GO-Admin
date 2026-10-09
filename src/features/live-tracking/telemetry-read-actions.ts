"use server";

import type { DocumentData, Firestore, Query } from "firebase-admin/firestore";

import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";

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
const TIME_FIELD = "client_ts";

type Loose = Record<string, unknown>;

async function requireTelemetryView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "driver_telemetry.view", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

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

function fromValue(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (Array.isArray(value)) return value.map(fromValue);
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Loose = {};
    for (const [key, inner] of Object.entries(value as Loose)) out[key] = fromValue(inner);
    return out;
  }
  return value;
}

function fromDoc(id: string, data: DocumentData | undefined): Loose {
  const out: Loose = { id };
  for (const [key, value] of Object.entries(data ?? {})) out[key] = fromValue(value);
  if (data?.id != null) out.id = fromValue(data.id) as string;
  return out;
}

function millisOf(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" && value.includes("T")) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function idLess(rowId: unknown, cursorId: string): boolean {
  const text = String(rowId ?? "");
  if (/^-?\d+$/.test(text) && /^-?\d+$/.test(cursorId)) return Number(text) < Number(cursorId);
  return text < cursorId;
}

function beforeCursor(row: Loose, cursor: { time: string; id: string }): boolean {
  const rowMs = millisOf(row[TIME_FIELD]);
  const cursorMs = millisOf(cursor.time);
  if (rowMs == null || cursorMs == null) return String(row[TIME_FIELD] ?? "") < cursor.time;
  if (rowMs < cursorMs) return true;
  if (rowMs > cursorMs) return false;
  return idLess(row.id, cursor.id);
}

async function requireDb(): Promise<Firestore> {
  const db = await staffDb();
  if (!db) throw new Error("not_configured");
  return db;
}

async function loadByIds(db: Firestore, collection: string, ids: string[]): Promise<Map<string, Loose>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, Loose>();
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const snaps = await db.getAll(...chunk.map((id) => db.collection(collection).doc(id)));
    for (const snap of snaps) {
      if (!snap.exists) continue;
      map.set(snap.id, fromDoc(snap.id, snap.data()));
    }
  }
  return map;
}

type EventSpec = {
  take: number;
  hardCap: number;
  driverId?: string | null;
  categories?: string[] | null;
  errorsOnly?: boolean;
  from?: string | null;
  to?: string | null;
  cursor?: TelemetryFeedCursor | null;
};

async function readGroup(
  db: Firestore,
  spec: EventSpec,
  category: string | null,
  fetchCap: number,
): Promise<Loose[]> {
  const build = (withRange: boolean): Query => {
    let query: Query = db.collection(COLLECTIONS.driverTelemetryEvents);
    if (spec.driverId) query = query.where("driver_id", "==", spec.driverId);
    if (category) query = query.where("category", "==", category);
    if (spec.errorsOnly) query = query.where("severity", "==", "error");
    if (withRange) {
      if (spec.from) query = query.where(TIME_FIELD, ">=", new Date(spec.from));
      const upper = spec.cursor?.clientTs ?? spec.to;
      if (upper) query = query.where(TIME_FIELD, "<=", new Date(upper));
      query = query.orderBy(TIME_FIELD, "desc");
    }
    return query.limit(fetchCap);
  };

  try {
    const snap = await build(true).get();
    return snap.docs.map((doc) => fromDoc(doc.id, doc.data()));
  } catch {
    try {
      const snap = await build(false).get();
      return snap.docs.map((doc) => fromDoc(doc.id, doc.data()));
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "query_failed");
    }
  }
}

async function queryEvents(db: Firestore, spec: EventSpec): Promise<Loose[]> {
  const categories = (spec.categories ?? []).filter(Boolean);
  const groups = categories.length > 0 && categories.length <= 10 ? categories : [null];
  const fetchCap = Math.min(Math.max(spec.take + 120, 200), spec.hardCap);
  const merged: Loose[] = [];
  for (const category of groups) {
    merged.push(...(await readGroup(db, spec, category, fetchCap)));
  }

  const filtered = merged.filter((row) => {
    if (spec.driverId && row.driver_id !== spec.driverId) return false;
    if (categories.length > 0 && !categories.includes(String(row.category ?? ""))) return false;
    if (spec.errorsOnly && row.severity !== "error") return false;
    if (spec.from) {
      const rowMs = millisOf(row[TIME_FIELD]);
      const fromMs = millisOf(spec.from);
      if (rowMs != null && fromMs != null ? rowMs < fromMs : String(row[TIME_FIELD] ?? "") < spec.from) {
        return false;
      }
    }
    if (spec.to) {
      const rowMs = millisOf(row[TIME_FIELD]);
      const toMs = millisOf(spec.to);
      if (rowMs != null && toMs != null ? rowMs > toMs : String(row[TIME_FIELD] ?? "") > spec.to) {
        return false;
      }
    }
    if (spec.cursor && !beforeCursor(row, { time: spec.cursor.clientTs, id: spec.cursor.id })) {
      return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    const delta = (millisOf(b[TIME_FIELD]) ?? 0) - (millisOf(a[TIME_FIELD]) ?? 0);
    if (delta !== 0) return delta;
    if (idLess(a.id, String(b.id ?? ""))) return 1;
    if (idLess(b.id, String(a.id ?? ""))) return -1;
    return 0;
  });

  const seen = new Set<string>();
  const unique: Loose[] = [];
  for (const row of filtered) {
    const id = String(row.id);
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(row);
    if (unique.length >= spec.take) break;
  }
  return unique;
}

async function withDrivers(db: Firestore, rows: Loose[]): Promise<RawTelemetryRow[]> {
  const ids = rows.map((row) => String(row.driver_id ?? "")).filter(Boolean);
  const [drivers, profiles] = await Promise.all([
    loadByIds(db, COLLECTIONS.drivers, ids),
    loadByIds(db, COLLECTIONS.profiles, ids),
  ]);
  return rows.map((row) => {
    const driverId = String(row.driver_id ?? "");
    const driver = drivers.get(driverId);
    const profile = profiles.get(driverId);
    return {
      ...(row as unknown as RawTelemetryRow),
      id: row.id as string | number,
      driver_id: driverId,
      client_ts: String(row.client_ts ?? ""),
      server_received_at: String(row.server_received_at ?? ""),
      drivers: driver
        ? {
            driver_code: (driver.driver_code as string | null) ?? null,
            profiles: profile
              ? { full_name: (profile.full_name as string | null) ?? null }
              : null,
          }
        : null,
    };
  });
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
  const db = await requireDb();
  const limit = Math.min(Math.max(filters.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const rows = await withDrivers(
    db,
    await queryEvents(db, { ...filters, take: limit + 1, hardCap: 2000 }),
  );
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
 * operations feed: the tiles only summarise the slice the feed is already showing.
 */
export async function fetchTelemetrySummary(range: {
  from: string;
  to?: string | null;
  driverId?: string | null;
}): Promise<TelemetrySummary> {
  await requireTelemetryView();
  const db = await requireDb();
  const rows = await queryEvents(db, {
    driverId: range.driverId,
    from: range.from,
    to: range.to,
    take: COUNT_WINDOW_ROWS,
    hardCap: COUNT_WINDOW_ROWS,
  });

  const byCategory = new Map<string, TelemetryCategoryCount>();
  let total = 0;
  let errors = 0;
  let maxClockSkewMs = 0;
  let offlineTransitions = 0;

  for (const row of rows) {
    const category = String(row.category ?? "");
    const entry = byCategory.get(category) ?? { category, total: 0, errors: 0 };
    entry.total += 1;
    total += 1;
    if (row.severity === "error") {
      entry.errors += 1;
      errors += 1;
    }
    byCategory.set(category, entry);
    const skew = Math.abs(typeof row.clock_skew_ms === "number" ? row.clock_skew_ms : 0);
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
    !hasPermissionInSet(session.permissions, "driver_telemetry.export", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }

  const db = await requireDb();
  const rows = await withDrivers(
    db,
    await queryEvents(db, { ...filters, take: EXPORT_MAX_ROWS, hardCap: EXPORT_MAX_ROWS }),
  );
  const events = rows.map(mapRow);

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
