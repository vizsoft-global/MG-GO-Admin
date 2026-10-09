"use server";

export type { ShiftAdherence } from "./shift-adherence";

import type { DocumentData, Firestore, Query } from "firebase-admin/firestore";

import { logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { callAdminFunction } from "@/lib/firebase/callable";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { parseTrackingStatus } from "@/features/locations/location-status";
import type { DriverLocationEvent } from "@/features/locations/types";
import { computeHistorySummary } from "@/features/live-tracking/history-summary-kpis";
import {
  kuwaitDateFromIso,
  kuwaitDayBounds,
  kuwaitToday,
  logDurationSeconds,
} from "./kuwait-time";
import {
  adherenceMapKey,
  parseShiftAdherence,
  type ShiftAdherence,
} from "./shift-adherence";
import { findActiveShiftRow, shiftRowToListFields, type ShiftRow } from "./shift-flags";

type Loose = Record<string, unknown>;

async function requireAttendanceView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "attendance.view", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

async function requireDb(): Promise<Firestore> {
  const db = await staffDb();
  if (!db) throw new Error("not_configured");
  return db;
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

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  if (value == null || value === "") return null;
  return String(value);
}

function asShift(row: Loose): ShiftRow {
  return {
    ...row,
    submitted_at: typeof row.submitted_at === "string" ? row.submitted_at : "",
  } as ShiftRow;
}

function toLocationEvent(raw: Loose): DriverLocationEvent {
  return {
    id: String(raw.id),
    driverId: String(raw.driver_id ?? ""),
    latitude: Number(raw.latitude),
    longitude: Number(raw.longitude),
    speedMps: num(raw.speed_mps),
    accuracyMeters: num(raw.accuracy_meters),
    batteryPct: num(raw.battery_pct),
    trackingStatus: parseTrackingStatus(String(raw.tracking_status ?? "idle")),
    zoneStatus: (raw.zone_status ?? null) as DriverLocationEvent["zoneStatus"],
    deliveryId: raw.delivery_id == null ? null : String(raw.delivery_id),
    recordedAt: String(raw.recorded_at ?? ""),
  };
}

async function loadByIds(db: Firestore, collection: string, ids: string[]): Promise<Map<string, Loose>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, Loose>();
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    if (chunk.length === 0) continue;
    const snaps = await db.getAll(...chunk.map((id) => db.collection(collection).doc(id)));
    for (const snap of snaps) {
      if (!snap.exists) continue;
      map.set(snap.id, fromDoc(snap.id, snap.data()));
    }
  }
  return map;
}

function mapDocs(docs: Array<{ id: string; data: () => DocumentData }>): Loose[] {
  return docs.map((doc) => fromDoc(doc.id, doc.data()));
}

async function readStringRange(
  db: Firestore,
  collection: string,
  field: string,
  from: string,
  to: string,
  direction: "asc" | "desc",
): Promise<Loose[]> {
  try {
    const snap = await db
      .collection(collection)
      .where(field, ">=", from)
      .where(field, "<=", to)
      .orderBy(field, direction)
      .get();
    return mapDocs(snap.docs);
  } catch {
    try {
      const snap = await db.collection(collection).where(field, ">=", from).where(field, "<=", to).get();
      const rows = mapDocs(snap.docs);
      rows.sort((a, b) => {
        const delta = String(a[field] ?? "").localeCompare(String(b[field] ?? ""));
        return direction === "desc" ? -delta : delta;
      });
      return rows;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "query_failed");
    }
  }
}

async function readTimeRange(
  db: Firestore,
  collection: string,
  field: string,
  fromIso: string,
  toIso: string,
): Promise<Loose[]> {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  try {
    const snap = await db
      .collection(collection)
      .where(field, ">=", from)
      .where(field, "<=", to)
      .orderBy(field, "asc")
      .get();
    return mapDocs(snap.docs);
  } catch {
    try {
      const snap = await db.collection(collection).where(field, ">=", from).where(field, "<=", to).get();
      const rows = mapDocs(snap.docs);
      rows.sort(
        (a, b) => Date.parse(String(a[field] ?? "")) - Date.parse(String(b[field] ?? "")),
      );
      return rows;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "query_failed");
    }
  }
}

async function readDriverStringRange(
  db: Firestore,
  collection: string,
  driverId: string,
  field: string,
  from: string,
  to: string,
  direction: "asc" | "desc",
): Promise<Loose[]> {
  try {
    const snap = await db
      .collection(collection)
      .where("driver_id", "==", driverId)
      .where(field, ">=", from)
      .where(field, "<=", to)
      .orderBy(field, direction)
      .get();
    return mapDocs(snap.docs);
  } catch {
    try {
      const snap = await db.collection(collection).where("driver_id", "==", driverId).get();
      const rows = mapDocs(snap.docs).filter((row) => {
        const value = String(row[field] ?? "");
        return value >= from && value <= to;
      });
      rows.sort((a, b) => {
        const delta = String(a[field] ?? "").localeCompare(String(b[field] ?? ""));
        return direction === "desc" ? -delta : delta;
      });
      return rows;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "query_failed");
    }
  }
}

async function readDriverDates(
  db: Firestore,
  collection: string,
  driverId: string,
  field: string,
  dates: string[],
): Promise<Loose[]> {
  if (dates.length === 0) return [];
  const wanted = new Set(dates);
  try {
    const snap = await db
      .collection(collection)
      .where("driver_id", "==", driverId)
      .where(field, "in", dates)
      .get();
    return mapDocs(snap.docs);
  } catch {
    try {
      const snap = await db.collection(collection).where("driver_id", "==", driverId).get();
      return mapDocs(snap.docs).filter((row) => wanted.has(String(row[field] ?? "")));
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "query_failed");
    }
  }
}

async function readDriverTimeRange(
  db: Firestore,
  collection: string,
  driverId: string,
  field: string,
  fromIso: string,
  toIso: string,
): Promise<Loose[]> {
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();
  const inWindow = (row: Loose) => {
    const ms = Date.parse(String(row[field] ?? ""));
    return Number.isFinite(ms) && ms >= fromMs && ms <= toMs;
  };
  try {
    const snap = await db
      .collection(collection)
      .where("driver_id", "==", driverId)
      .where(field, ">=", new Date(fromIso))
      .where(field, "<=", new Date(toIso))
      .orderBy(field, "asc")
      .get();
    return mapDocs(snap.docs);
  } catch {
    try {
      const snap = await db.collection(collection).where("driver_id", "==", driverId).get();
      const rows = mapDocs(snap.docs).filter(inWindow);
      rows.sort((a, b) => Date.parse(String(a[field] ?? "")) - Date.parse(String(b[field] ?? "")));
      return rows;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "query_failed");
    }
  }
}

async function readMaybe(
  db: Firestore,
  collection: string,
  eqs: Array<[string, unknown]>,
): Promise<Loose | null> {
  const matches = (row: Loose) =>
    eqs.every(([field, value]) => (value == null ? row[field] == null : row[field] === value));
  try {
    let query: Query = db.collection(collection);
    for (const [field, value] of eqs) query = query.where(field, "==", value);
    const snap = await query.limit(1).get();
    const doc = snap.docs[0];
    return doc ? fromDoc(doc.id, doc.data()) : null;
  } catch {
    const [field, value] = eqs[0] ?? ["id", ""];
    const snap = await db.collection(collection).where(field, "==", value).get();
    return mapDocs(snap.docs).find(matches) ?? null;
  }
}

type AdherenceListRow = {
  driver_id: string;
  attendance_date: string;
  shift_adherence: unknown;
};

async function fetchAdherenceMap(
  fromDate: string,
  toDate: string,
  driverIds?: string[],
): Promise<Map<string, ShiftAdherence>> {
  const args: Record<string, unknown> = { p_from: fromDate, p_to: toDate };
  if (driverIds && driverIds.length > 0) args.p_driver_ids = driverIds;
  const { data, error } = await callAdminFunction<AdherenceListRow[] | null>(
    "admin_list_shift_adherence",
    args,
  );
  if (error) throw new Error(error.message);

  const map = new Map<string, ShiftAdherence>();
  const rows = Array.isArray(data) ? data : [];
  for (const row of rows) {
    const parsed = parseShiftAdherence(row.shift_adherence);
    if (parsed) {
      map.set(adherenceMapKey(row.driver_id, row.attendance_date), parsed);
    }
  }
  return map;
}

async function fetchShiftAdherence(
  driverId: string,
  date: string,
): Promise<ShiftAdherence | null> {
  const { data, error } = await callAdminFunction<unknown>("admin_get_shift_adherence", {
    p_driver_id: driverId,
    p_date: date,
  });
  if (error) throw new Error(error.message);
  return parseShiftAdherence(data);
}

function buildDriverShiftListRow(
  row: ShiftRow,
  driver: DriverMeta,
  shiftAdherence: ShiftAdherence | null = null,
  nowMs: number = Date.now(),
): DriverShiftListRow {
  const fields = shiftRowToListFields(row, nowMs);
  return {
    id: row.id,
    driver_id: row.driver_id,
    driver_code: driver.driver_code,
    driver_name: driver.full_name,
    driver_phone: driver.phone,
    zone_name: driver.zone_name,
    partner_name: driver.partner_name,
    shift_date: row.shift_date,
    shift_type: row.shift_type as "single" | "split",
    session1_label: fields.session1_label,
    session2_label: fields.session2_label,
    is_within_window: fields.is_within_window,
    is_locked: fields.is_locked,
    is_active: fields.is_active,
    is_expired: fields.is_expired,
    shift_end_at: fields.shift_end_at,
    is_on_duty: driver.is_on_duty,
    submitted_at: row.submitted_at,
    shift_adherence: shiftAdherence,
  };
}

type DriverMeta = {
  id: string;
  driver_code: string;
  is_on_duty: boolean;
  zone_id: string | null;
  partner_id: string | null;
  zone_name: string;
  partner_name: string;
  full_name: string;
  phone: string;
};

async function loadActiveDrivers(db: Firestore): Promise<Loose[]> {
  try {
    const snap = await db
      .collection(COLLECTIONS.drivers)
      .where("status", "==", "active")
      .where("archived_at", "==", null)
      .get();
    return mapDocs(snap.docs);
  } catch {
    const snap = await db.collection(COLLECTIONS.drivers).where("status", "==", "active").get();
    return mapDocs(snap.docs).filter((row) => row.archived_at == null);
  }
}

function metaFrom(
  row: Loose,
  profile: Loose | undefined,
  zone: Loose | undefined,
  partner: Loose | undefined,
): DriverMeta {
  return {
    id: String(row.id),
    driver_code: String(row.driver_code ?? ""),
    is_on_duty: row.is_on_duty === true,
    zone_id: text(row.zone_id),
    partner_id: text(row.partner_id),
    zone_name: String(zone?.name ?? "").trim() || "—",
    partner_name: String(partner?.name ?? "").trim() || "—",
    full_name: String(profile?.full_name ?? "").trim() || "—",
    phone: String(profile?.phone ?? "").trim() || "—",
  };
}

async function fetchDriverMetaMap(): Promise<Map<string, DriverMeta>> {
  const db = await requireDb();
  const drivers = await loadActiveDrivers(db);
  const ids = drivers.map((row) => String(row.id));
  const [profiles, zones, partners] = await Promise.all([
    loadByIds(db, COLLECTIONS.profiles, ids),
    loadByIds(
      db,
      COLLECTIONS.zones,
      drivers.map((row) => String(row.zone_id ?? "")),
    ),
    loadByIds(
      db,
      COLLECTIONS.partners,
      drivers.map((row) => String(row.partner_id ?? "")),
    ),
  ]);

  const map = new Map<string, DriverMeta>();
  for (const row of drivers) {
    const id = String(row.id);
    map.set(
      id,
      metaFrom(row, profiles.get(id), zones.get(String(row.zone_id ?? "")), partners.get(String(row.partner_id ?? ""))),
    );
  }
  return map;
}

export type DriverShiftListRow = {
  id: string;
  driver_id: string;
  driver_code: string;
  driver_name: string;
  driver_phone: string;
  zone_name: string;
  partner_name: string;
  shift_date: string;
  shift_type: "single" | "split";
  session1_label: string;
  session2_label: string | null;
  is_within_window: boolean;
  is_locked: boolean;
  is_active: boolean;
  is_expired: boolean;
  shift_end_at: string;
  is_on_duty: boolean;
  submitted_at: string;
  shift_adherence: ShiftAdherence | null;
};

export async function fetchDriverShiftsList(params: {
  fromDate: string;
  toDate: string;
  zoneId?: string;
  partnerId?: string;
}): Promise<DriverShiftListRow[]> {
  await requireAttendanceView();
  void logAdminRead("driver_daily_shifts", "fetchDriverShiftsList", params);

  const db = await requireDb();
  const data = await readStringRange(
    db,
    COLLECTIONS.driverDailyShifts,
    "shift_date",
    params.fromDate,
    params.toDate,
    "desc",
  );

  const meta = await fetchDriverMetaMap();
  const adherenceMap = await fetchAdherenceMap(params.fromDate, params.toDate);
  const rows: DriverShiftListRow[] = [];

  for (const raw of data) {
    const row = asShift(raw);
    const driver = meta.get(row.driver_id);
    if (!driver) continue;
    if (params.zoneId && params.zoneId !== "all" && driver.zone_id !== params.zoneId) continue;
    if (params.partnerId && params.partnerId !== "all" && driver.partner_id !== params.partnerId) {
      continue;
    }

    const adherence =
      adherenceMap.get(adherenceMapKey(row.driver_id, row.shift_date)) ?? null;

    rows.push(buildDriverShiftListRow(row, driver, adherence));
  }

  return rows;
}

export type WorktimeListRow = {
  key: string;
  driver_id: string;
  driver_code: string;
  driver_name: string;
  driver_phone: string;
  zone_name: string;
  partner_name: string;
  attendance_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  log_duration_seconds: number | null;
  online_seconds: number;
  session_count: number;
  distance_meters: number | null;
  idle_minutes: number | null;
  moving_minutes: number | null;
  attendance_status: string | null;
  is_validated: boolean;
  validation_source: string | null;
  is_on_duty: boolean;
  log_id: string | null;
  first_online_at: string | null;
  shift_type: "single" | "split" | null;
  session1_label: string | null;
  session2_label: string | null;
  shift_adherence: ShiftAdherence | null;
};

function displayOnlineSeconds(
  base: number,
  attendanceDate: string,
  lastOnlineAt: string | null,
  hasOpenSession: boolean,
): number {
  const today = kuwaitToday();
  if (attendanceDate !== today || !hasOpenSession || !lastOnlineAt) return base;
  const extra = Math.max(0, Math.floor((Date.now() - new Date(lastOnlineAt).getTime()) / 1000));
  return base + extra;
}

export async function fetchWorktimeList(params: {
  fromDate: string;
  toDate: string;
  zoneId?: string;
  partnerId?: string;
}): Promise<WorktimeListRow[]> {
  await requireAttendanceView();
  void logAdminRead("worktime", "fetchWorktimeList", params);

  const db = await requireDb();
  const meta = await fetchDriverMetaMap();
  if (meta.size === 0) return [];

  const { from: rangeFrom } = kuwaitDayBounds(params.fromDate);
  const { to: rangeTo } = kuwaitDayBounds(params.toDate);

  const [attendanceRows, logRows, sessionRows, eventRows, shiftRows, adherenceMap] =
    await Promise.all([
      readStringRange(db, "driver_attendance", "attendance_date", params.fromDate, params.toDate, "asc"),
      readStringRange(db, COLLECTIONS.attendanceLogs, "log_date", params.fromDate, params.toDate, "asc"),
      readTimeRange(db, COLLECTIONS.driverSessions, "went_online_at", rangeFrom, rangeTo),
      readTimeRange(db, COLLECTIONS.driverLocationEvents, "recorded_at", rangeFrom, rangeTo),
      readStringRange(
        db,
        COLLECTIONS.driverDailyShifts,
        "shift_date",
        params.fromDate,
        params.toDate,
        "desc",
      ),
      fetchAdherenceMap(params.fromDate, params.toDate, [...meta.keys()]),
    ]);

  const shiftByKey = new Map<string, ShiftRow>();
  for (const raw of shiftRows) {
    if (!meta.has(String(raw.driver_id ?? ""))) continue;
    const row = asShift(raw);
    shiftByKey.set(adherenceMapKey(row.driver_id, row.shift_date), row);
  }

  const openSessionDrivers = new Set(
    sessionRows.filter((row) => row.is_online === true && meta.has(String(row.driver_id ?? ""))).map((row) => String(row.driver_id)),
  );

  const sessionCountByKey = new Map<string, number>();
  for (const row of sessionRows) {
    const driverId = String(row.driver_id ?? "");
    if (!meta.has(driverId) || !row.went_online_at) continue;
    const day = kuwaitDateFromIso(String(row.went_online_at));
    if (day < params.fromDate || day > params.toDate) continue;
    const key = `${driverId}:${day}`;
    sessionCountByKey.set(key, (sessionCountByKey.get(key) ?? 0) + 1);
  }

  const eventsByKey = new Map<string, DriverLocationEvent[]>();
  for (const raw of eventRows) {
    const driverId = String(raw.driver_id ?? "");
    if (!meta.has(driverId) || !raw.recorded_at) continue;
    const day = kuwaitDateFromIso(String(raw.recorded_at));
    const key = `${driverId}:${day}`;
    const list = eventsByKey.get(key) ?? [];
    list.push(toLocationEvent(raw));
    eventsByKey.set(key, list);
  }

  const logByKey = new Map<string, Loose>();
  for (const log of logRows) {
    const driverId = String(log.driver_id ?? "");
    if (!meta.has(driverId)) continue;
    logByKey.set(`${driverId}:${String(log.log_date ?? "")}`, log);
  }

  const attendanceByKey = new Map<string, Loose>();
  for (const row of attendanceRows) {
    const driverId = String(row.driver_id ?? "");
    if (!meta.has(driverId)) continue;
    attendanceByKey.set(`${driverId}:${String(row.attendance_date ?? "")}`, row);
  }

  const keys = new Set<string>();
  for (const key of attendanceByKey.keys()) keys.add(key);
  for (const key of logByKey.keys()) keys.add(key);

  const rows: WorktimeListRow[] = [];

  for (const key of keys) {
    const sep = key.indexOf(":");
    const driverId = key.slice(0, sep);
    const date = key.slice(sep + 1);
    if (!driverId || !date) continue;
    const driver = meta.get(driverId);
    if (!driver) continue;
    if (params.zoneId && params.zoneId !== "all" && driver.zone_id !== params.zoneId) continue;
    if (params.partnerId && params.partnerId !== "all" && driver.partner_id !== params.partnerId) {
      continue;
    }

    const att = attendanceByKey.get(key);
    const log = logByKey.get(key);
    const events = eventsByKey.get(key) ?? [];
    const summary = computeHistorySummary(events);
    const shiftRow = shiftByKey.get(key);
    const shiftAdherence = adherenceMap.get(key) ?? null;
    const shiftFields = shiftRow ? shiftRowToListFields(shiftRow) : null;

    rows.push({
      key,
      driver_id: driverId,
      driver_code: driver.driver_code,
      driver_name: driver.full_name,
      driver_phone: driver.phone,
      zone_name: driver.zone_name,
      partner_name: driver.partner_name,
      attendance_date: date,
      check_in_at: text(log?.check_in_at),
      check_out_at: text(log?.check_out_at),
      log_duration_seconds: logDurationSeconds(
        text(log?.check_in_at),
        text(log?.check_out_at),
      ),
      online_seconds: displayOnlineSeconds(
        num(att?.online_seconds) ?? 0,
        date,
        text(att?.last_online_at),
        openSessionDrivers.has(driverId),
      ),
      session_count: sessionCountByKey.get(key) ?? 0,
      distance_meters: num(log?.distance_meters),
      idle_minutes: summary.idleMinutes,
      moving_minutes: summary.movingMinutes,
      attendance_status: text(att?.status),
      is_validated: att?.is_validated === true,
      validation_source: text(att?.validation_source),
      is_on_duty: driver.is_on_duty,
      log_id: text(log?.id),
      first_online_at: text(att?.first_online_at),
      shift_type: shiftRow ? (shiftRow.shift_type as "single" | "split") : null,
      session1_label: shiftFields?.session1_label ?? null,
      session2_label: shiftFields?.session2_label ?? null,
      shift_adherence: shiftAdherence,
    });
  }

  return rows;
}

export async function fetchDriverAttendanceMonth(
  driverId: string,
  year: number,
  month: number,
): Promise<
  {
    attendance_date: string;
    online_seconds: number;
    status: string;
    is_validated: boolean;
    shift_adherence: ShiftAdherence | null;
  }[]
> {
  await requireAttendanceView();
  const db = await requireDb();
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const [data, adherenceMap] = await Promise.all([
    readDriverStringRange(db, "driver_attendance", driverId, "attendance_date", monthStart, monthEnd, "asc"),
    fetchAdherenceMap(monthStart, monthEnd, [driverId]),
  ]);

  let openSession = false;
  try {
    const row = await readMaybe(db, COLLECTIONS.driverSessions, [
      ["driver_id", driverId],
      ["is_online", true],
    ]);
    openSession = Boolean(row);
  } catch {
    openSession = false;
  }

  const today = kuwaitToday();
  return data.map((row) => ({
    attendance_date: String(row.attendance_date ?? ""),
    online_seconds: displayOnlineSeconds(
      num(row.online_seconds) ?? 0,
      String(row.attendance_date ?? ""),
      text(row.last_online_at),
      openSession && row.attendance_date === today,
    ),
    status: String(row.status ?? ""),
    is_validated: row.is_validated === true,
    shift_adherence:
      adherenceMap.get(adherenceMapKey(driverId, String(row.attendance_date ?? ""))) ?? null,
  }));
}

export type FleetOpsCounts = {
  on_duty: number;
  online_sessions: number;
  unvalidated_today: number;
  out_of_zone: number;
};

async function headCount(build: () => Query): Promise<number | null> {
  try {
    const snap = await build().count().get();
    return snap.data().count;
  } catch {
    return null;
  }
}

export async function fetchFleetOpsCounts(): Promise<FleetOpsCounts> {
  await requireAttendanceView();
  const db = await requireDb();
  const today = kuwaitToday();

  const [onDuty, onlineSessions, unvalidated, outOfZone] = await Promise.all([
    headCount(() =>
      db
        .collection(COLLECTIONS.drivers)
        .where("status", "==", "active")
        .where("archived_at", "==", null)
        .where("is_on_duty", "==", true),
    ),
    headCount(() => db.collection(COLLECTIONS.driverSessions).where("is_online", "==", true)),
    headCount(() =>
      db
        .collection("driver_attendance")
        .where("attendance_date", "==", today)
        .where("status", "==", "online_unvalidated"),
    ),
    headCount(() => db.collection(COLLECTIONS.driverLocations).where("zone_status", "==", "out_of_zone")),
  ]);

  let onDutyCount = onDuty;
  if (onDutyCount == null) {
    try {
      const rows = await loadActiveDrivers(db);
      onDutyCount = rows.filter((row) => row.is_on_duty === true).length;
    } catch {
      onDutyCount = 0;
    }
  }

  let unvalidatedCount = unvalidated;
  if (unvalidatedCount == null) {
    try {
      const snap = await db.collection("driver_attendance").where("attendance_date", "==", today).get();
      unvalidatedCount = mapDocs(snap.docs).filter((row) => row.status === "online_unvalidated").length;
    } catch {
      unvalidatedCount = 0;
    }
  }

  return {
    on_duty: onDutyCount ?? 0,
    online_sessions: onlineSessions ?? 0,
    unvalidated_today: unvalidatedCount ?? 0,
    out_of_zone: outOfZone ?? 0,
  };
}

async function fetchSingleDriverMeta(driverId: string): Promise<DriverMeta | null> {
  const db = await requireDb();
  const snap = await db.collection(COLLECTIONS.drivers).doc(driverId).get();
  if (!snap.exists) return null;
  const row = fromDoc(snap.id, snap.data());
  const [profiles, zones, partners] = await Promise.all([
    loadByIds(db, COLLECTIONS.profiles, [driverId]),
    loadByIds(db, COLLECTIONS.zones, [String(row.zone_id ?? "")]),
    loadByIds(db, COLLECTIONS.partners, [String(row.partner_id ?? "")]),
  ]);
  return metaFrom(
    row,
    profiles.get(driverId),
    zones.get(String(row.zone_id ?? "")),
    partners.get(String(row.partner_id ?? "")),
  );
}

export async function fetchDriverTodayTrackingSummary(driverId: string): Promise<{
  shift: DriverShiftListRow | null;
  worktime: WorktimeListRow | null;
  shift_adherence: ShiftAdherence | null;
}> {
  await requireAttendanceView();
  const today = kuwaitToday();
  const db = await requireDb();
  const { from: rangeFrom, to: rangeTo } = kuwaitDayBounds(today);
  const yesterday = (() => {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  const [driver, shiftRows, attendance, log, sessions, events, openSession, shiftAdherence] =
    await Promise.all([
      fetchSingleDriverMeta(driverId),
      readDriverDates(db, COLLECTIONS.driverDailyShifts, driverId, "shift_date", [today, yesterday]),
      readMaybe(db, "driver_attendance", [
        ["driver_id", driverId],
        ["attendance_date", today],
      ]),
      readMaybe(db, COLLECTIONS.attendanceLogs, [
        ["driver_id", driverId],
        ["log_date", today],
      ]),
      readDriverTimeRange(db, COLLECTIONS.driverSessions, driverId, "went_online_at", rangeFrom, rangeTo),
      readDriverTimeRange(
        db,
        COLLECTIONS.driverLocationEvents,
        driverId,
        "recorded_at",
        rangeFrom,
        rangeTo,
      ),
      readMaybe(db, COLLECTIONS.driverSessions, [
        ["driver_id", driverId],
        ["is_online", true],
      ]),
      fetchShiftAdherence(driverId, today),
    ]);

  if (!driver) return { shift: null, worktime: null, shift_adherence: null };

  const shifts = shiftRows.map(asShift);
  const activeShift = findActiveShiftRow(shifts, today);
  const todayShift = shifts.find((row) => row.shift_date === today) ?? null;
  const displayShiftRow = activeShift ?? todayShift;

  let shift: DriverShiftListRow | null = null;
  if (displayShiftRow) {
    shift = buildDriverShiftListRow(displayShiftRow, driver, shiftAdherence);
  }

  const hasOpenSession = Boolean(openSession);
  const mappedEvents = events.map(toLocationEvent);
  const summary = computeHistorySummary(mappedEvents);

  let sessionCount = 0;
  for (const row of sessions) {
    if (!row.went_online_at) continue;
    if (kuwaitDateFromIso(String(row.went_online_at)) === today) sessionCount += 1;
  }

  const worktime: WorktimeListRow | null =
    attendance || log
      ? {
          key: `${driverId}:${today}`,
          driver_id: driverId,
          driver_code: driver.driver_code,
          driver_name: driver.full_name,
          driver_phone: driver.phone,
          zone_name: driver.zone_name,
          partner_name: driver.partner_name,
          attendance_date: today,
          check_in_at: text(log?.check_in_at),
          check_out_at: text(log?.check_out_at),
          log_duration_seconds: logDurationSeconds(text(log?.check_in_at), text(log?.check_out_at)),
          online_seconds: displayOnlineSeconds(
            num(attendance?.online_seconds) ?? 0,
            today,
            text(attendance?.last_online_at),
            hasOpenSession,
          ),
          session_count: sessionCount,
          distance_meters: num(log?.distance_meters),
          idle_minutes: summary.idleMinutes,
          moving_minutes: summary.movingMinutes,
          attendance_status: text(attendance?.status),
          is_validated: attendance?.is_validated === true,
          validation_source: text(attendance?.validation_source),
          is_on_duty: driver.is_on_duty,
          log_id: text(log?.id),
          first_online_at: text(attendance?.first_online_at),
          shift_type: displayShiftRow ? (displayShiftRow.shift_type as "single" | "split") : null,
          session1_label: shift?.session1_label ?? null,
          session2_label: shift?.session2_label ?? null,
          shift_adherence: shiftAdherence,
        }
      : null;

  return { shift, worktime, shift_adherence: shiftAdherence };
}
