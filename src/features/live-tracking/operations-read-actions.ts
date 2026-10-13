"use server";

import type { DocumentData, Firestore, Query } from "firebase-admin/firestore";

import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";

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
const TIME_FIELD = "occurred_at";

type Loose = Record<string, unknown>;

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
  failuresOnly?: boolean;
  from?: string | null;
  to?: string | null;
  cursor?: OperationFeedCursor | null;
};

async function readGroup(
  db: Firestore,
  spec: EventSpec,
  category: string | null,
  fetchCap: number,
): Promise<Loose[]> {
  const build = (withRange: boolean): Query => {
    let query: Query = db.collection(COLLECTIONS.driverOperationEvents);
    if (spec.driverId) query = query.where("driver_id", "==", spec.driverId);
    if (category) query = query.where("category", "==", category);
    if (spec.failuresOnly) query = query.where("success", "==", false);
    if (withRange) {
      if (spec.from) query = query.where(TIME_FIELD, ">=", new Date(spec.from));
      const upper = spec.cursor?.occurredAt ?? spec.to;
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
    if (spec.failuresOnly && row.success !== false) return false;
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
    if (spec.cursor && !beforeCursor(row, { time: spec.cursor.occurredAt, id: spec.cursor.id })) {
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

async function withDrivers(db: Firestore, rows: Loose[]): Promise<RawEventRow[]> {
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
      ...(row as unknown as RawEventRow),
      id: row.id as string | number,
      driver_id: driverId,
      occurred_at: String(row.occurred_at ?? ""),
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
 * Keyset pagination rather than range/offset: the feed is append-heavy, so an
 * offset page would both skip and repeat rows as new events land while an
 * operator reads.
 */
export async function fetchDriverOperationFeed(
  filters: OperationFeedFilters = {},
): Promise<OperationFeedPage> {
  await requireOpsView();
  const db = await requireDb();
  const limit = Math.min(Math.max(filters.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const rows = await withDrivers(
    db,
    await queryEvents(db, { ...filters, take: limit + 1, hardCap: 2000 }),
  );
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
    nextCursor: hasMore && last ? { occurredAt: last.occurredAt, id: last.id } : null,
  };
}

/** Driver popup + detail timeline — newest first, no pagination. */
export async function fetchDriverOperationTimeline(
  driverId: string,
  limit = 20,
): Promise<DriverOperationEvent[]> {
  await requireOpsView();
  if (!driverId) return [];
  const db = await requireDb();
  const take = Math.min(Math.max(limit, 1), MAX_LIMIT);
  const rows = await withDrivers(
    db,
    await queryEvents(db, { driverId, take, hardCap: 500 }),
  );
  void logAdminRead("driver_operation_events", "driverOps.fetchTimeline", { driverId });
  return rows.map(mapEventRow);
}

export type OperationCategoryCount = {
  category: string;
  total: number;
  failures: number;
};

/**
 * KPI tiles. Counted client-side over a capped window instead of a GROUP BY RPC:
 * the tiles only ever summarise the same slice the feed is showing.
 */
export async function fetchOperationCategoryCounts(range: {
  from: string;
  to?: string | null;
  driverId?: string | null;
}): Promise<OperationCategoryCount[]> {
  await requireOpsView();
  const db = await requireDb();
  const rows = await queryEvents(db, {
    driverId: range.driverId,
    from: range.from,
    to: range.to,
    take: 10000,
    hardCap: 10000,
  });

  const byCategory = new Map<string, OperationCategoryCount>();
  for (const row of rows) {
    const category = String(row.category ?? "");
    const entry = byCategory.get(category) ?? { category, total: 0, failures: 0 };
    entry.total += 1;
    if (row.success === false) entry.failures += 1;
    byCategory.set(category, entry);
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

  const db = await requireDb();
  const rows = await withDrivers(
    db,
    await queryEvents(db, { ...filters, take: EXPORT_MAX_ROWS, hardCap: EXPORT_MAX_ROWS }),
  );
  const events = rows.map(mapEventRow);

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
