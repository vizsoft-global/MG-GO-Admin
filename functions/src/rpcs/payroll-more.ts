/**
 * Payroll month snapshot, manual adjustments and zone efficiency — ports of
 * `admin_payroll_month_snapshot`, `admin_apply_payroll_adjustments`,
 * `admin_payroll_adjustment_audit`, `admin_payroll_zone_settings`,
 * `admin_save_payroll_zone_settings`, `admin_save_payroll_zone_override` and
 * `admin_recompute_payroll_zone_metrics`.
 *
 * Adjustments are append-only: the newest row per (driver, day) wins and an
 * `auto` row is a revert, so nothing here ever updates or deletes one.
 *
 * Zone efficiency is computed from a completed month and an unmeasured zone is
 * `null` (the panel's `not_set`), never 0 — a null denominator is not divided.
 */
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  getFirestore,
  FieldValue,
  Timestamp,
  type DocumentReference,
  type Firestore,
} from "firebase-admin/firestore";
import { COLLECTIONS } from "../core/collections";
import {
  KUWAIT_OFFSET_MS,
  daysInMonth,
  kuwaitDayRange,
  kuwaitDayString,
  monthKey,
  monthLabel,
  parseMonthKey,
} from "../core/kuwait";
import { requireStaff, type StaffContext } from "../core/staff";
import {
  BATCH_LIMIT,
  chunk,
  loadDocMap,
  numberOrNull,
  pick,
  pickDay,
  pickId,
  pickIdList,
  pickText,
  type Dict,
} from "./_shared";

const DEFAULT_OFF_DAYS = 2;
const DAY_HOURS = 12;
const DEFAULT_GOOD = 110;
const DEFAULT_AVERAGE = 70;
const MONTH_SCAN_CAP = 40_000;
const AUDIT_SCAN_CAP = 5_000;
const MAX_CELLS = 4000;
const MAX_REASON = 500;
const MAX_DPD = 100_000;
const MAX_EFFICIENCY = 1000;
const RECOMPUTE_WINDOW_MONTHS = 24;

const ADJUSTMENT_STATUSES = new Set([
  "auto",
  "12",
  "3h",
  "half",
  "actual",
  "off",
  "abs",
  "abs_lh",
  "abs_lo",
  "sick",
  "accident",
  "vehicle",
  "custom",
]);
const ZONE_CATEGORIES = new Set(["good", "average", "low"]);
const APPROVED_STATUSES = new Set(["approved", "awaiting_driver_ack"]);

const ROLE_LABELS: Record<string, string> = {
  reporting_manager: "Reporting Manager",
  manager: "Reporting Manager",
  hr: "HR",
  payroll: "Payroll",
  fleet: "Fleet",
  operations: "Operations",
  finance: "Finance",
};

// --- small helpers ------------------------------------------------------------

function argDict(data: unknown): Dict {
  return typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Dict) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}

function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function monthIndex(key: string): number {
  const { year, month } = parseMonthKey(key);
  return year * 12 + (month - 1);
}

function shiftMonth(key: string, delta: number): string {
  const index = monthIndex(key) + delta;
  return monthKey(Math.floor(index / 12), (index % 12) + 1);
}

function currentKuwaitMonth(): string {
  return kuwaitDayString(new Date()).slice(0, 7);
}

const monthDay = (key: string): string => `${key}-01`;

/** `date_trunc('month', p_month)` over a `YYYY-MM` or `YYYY-MM-DD` argument. */
function parseMonthArg(data: Dict, ...names: string[]): string | null {
  const raw = pickText(data, ...names);
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})(?:-\d{2})?/.exec(raw);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return `${match[1]}-${match[2]}`;
}

function requireMonthArg(data: Dict, ...names: string[]): string {
  const key = parseMonthArg(data, ...names);
  if (!key) throw new HttpsError("invalid-argument", "invalid_month");
  return key;
}

/** `to_char(ts AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM-DD HH24:MI')`. */
function kuwaitMinuteString(value: unknown): string | null {
  const date = asDate(value);
  if (!date) return null;
  const iso = new Date(date.getTime() + KUWAIT_OFFSET_MS).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** `payroll_zone_band`. */
function zoneBand(efficiency: number | null, good: number | null, average: number | null): string | null {
  if (efficiency === null) return null;
  if (efficiency >= (good ?? DEFAULT_GOOD)) return "good";
  if (efficiency >= (average ?? DEFAULT_AVERAGE)) return "average";
  return "low";
}

/** `to_jsonb(row)`: Timestamps become ISO strings so the wire shape is plain JSON. */
function serialiseRow(data: Dict): Dict {
  const out: Dict = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = value instanceof Timestamp ? value.toDate().toISOString() : value;
  }
  return out;
}

function canManagePayroll(staff: StaffContext): boolean {
  if (staff.isSuperAdmin || staff.isManager) return true;
  return (
    staff.permissionSlugs.has("payroll.manage") ||
    staff.permissionSlugs.has("payroll.edit") ||
    staff.permissionSlugs.has("payroll.create")
  );
}

function requirePayrollManager(staff: StaffContext): void {
  if (!canManagePayroll(staff)) throw new HttpsError("permission-denied", "not_authorized");
}

async function actorName(db: Firestore, uid: string): Promise<string> {
  const snap = await db.collection(COLLECTIONS.profiles).doc(uid).get();
  const name = trimmedOrNull((snap.data() ?? {}).full_name);
  return name ?? "Unknown";
}

/** `payroll_log_rule_change`. */
async function logRuleChange(args: {
  db: Firestore;
  actorId: string;
  actorName: string;
  clientKey: string | null;
  periodMonth: string | null;
  entity: string;
  action: string;
  before: unknown;
  after: unknown;
}): Promise<void> {
  await args.db.collection(COLLECTIONS.payrollRuleAuditLogs).add({
    client_key: args.clientKey,
    period_month: args.periodMonth,
    entity: args.entity,
    action: args.action,
    actor_id: args.actorId,
    actor_name: args.actorName,
    before: args.before ?? null,
    after: args.after ?? null,
    created_at: FieldValue.serverTimestamp(),
  });
}

function firstRestaurantId(raw: Dict): string | null {
  const ids = new Set<string>();
  const single = asString(raw["restaurant_id"]);
  if (single) ids.add(single);
  if (Array.isArray(raw["restaurant_ids"])) {
    for (const id of raw["restaurant_ids"] as unknown[]) {
      if (typeof id === "string" && id.length) ids.add(id);
    }
  }
  if (!ids.size) return null;
  return [...ids].sort((a, b) => a.localeCompare(b))[0];
}

function sortedRestaurantIds(raw: Dict): string[] {
  const ids = new Set<string>();
  const single = asString(raw["restaurant_id"]);
  if (single) ids.add(single);
  if (Array.isArray(raw["restaurant_ids"])) {
    for (const id of raw["restaurant_ids"] as unknown[]) {
      if (typeof id === "string" && id.length) ids.add(id);
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

function inList(list: string[] | null, value: string | null): boolean {
  if (!list || list.length === 0) return true;
  return value !== null && list.includes(value);
}

// --- zone metrics storage -------------------------------------------------------

async function zoneMetricsForMonth(
  db: Firestore,
  periodMonth: string,
): Promise<Map<string, { ref: DocumentReference; data: Dict }>> {
  const snap = await db
    .collection(COLLECTIONS.payrollZoneMetrics)
    .where("period_month", "==", periodMonth)
    .get();
  const out = new Map<string, { ref: DocumentReference; data: Dict }>();
  for (const doc of snap.docs) {
    const data = (doc.data() ?? {}) as Dict;
    const zoneId = asString(data["zone_id"]) ?? doc.id.split("__")[0];
    out.set(zoneId, { ref: doc.ref, data });
  }
  return out;
}

const zoneMetricDocId = (zoneId: string, periodMonth: string) => `${zoneId}__${periodMonth}`;

// --- 1. adjustments ---------------------------------------------------------------

/**
 * `admin_apply_payroll_adjustments` — one write for a whole selection. Every cell
 * is validated before anything is written, so a bad cell refuses the batch the
 * way the SQL's RAISE rolled the whole call back.
 */
export const adminApplyPayrollAdjustments = onCall(async (request) => {
  const staff = await requireStaff(request, "payroll.manage");
  requirePayrollManager(staff);
  const data = argDict(request.data);
  const db = getFirestore();

  const reasonRaw = pick(data, "p_reason", "reason");
  const reason = typeof reasonRaw === "string" ? reasonRaw.trim() : "";
  if (!reason || reason.length > MAX_REASON) {
    throw new HttpsError("invalid-argument", "reason_required");
  }

  const cellsRaw = pick(data, "p_cells", "cells") ?? [];
  if (!Array.isArray(cellsRaw)) throw new HttpsError("invalid-argument", "invalid_cells");
  if (cellsRaw.length === 0) throw new HttpsError("invalid-argument", "no_cells");
  if (cellsRaw.length > MAX_CELLS) throw new HttpsError("invalid-argument", "too_many_cells");

  const scope = pickIdList(data, "p_driver_ids", "driverIds");
  const today = kuwaitDayString(new Date());
  const currentMonth = today.slice(0, 7);
  const minDay = monthDay(shiftMonth(currentMonth, -2));

  type Cell = {
    driverId: string;
    date: string;
    status: string;
    hours: number | null;
    original: string | null;
  };
  const cells: Cell[] = [];

  for (const raw of cellsRaw) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new HttpsError("invalid-argument", "invalid_cell");
    }
    const cell = raw as Dict;
    const driverId = pickId(cell, "driverId", "driver_id");
    const dateRaw = pickText(cell, "date", "workDate", "work_date");
    const dateMatch = dateRaw ? /^\d{4}-\d{2}-\d{2}$/.exec(dateRaw) : null;
    if (!driverId || !dateMatch || Number.isNaN(Date.parse(`${dateMatch[0]}T00:00:00Z`))) {
      throw new HttpsError("invalid-argument", "invalid_cell");
    }
    const date = dateMatch[0];

    const status = (typeof cell.status === "string" ? cell.status : "").trim().toLowerCase();
    if (!ADJUSTMENT_STATUSES.has(status)) {
      throw new HttpsError("invalid-argument", `invalid_adjustment_status:${status}`);
    }

    const hoursRaw = cell.hours;
    let hours: number | null = null;
    if (hoursRaw !== undefined && hoursRaw !== null && hoursRaw !== "") {
      hours = numberOrNull(hoursRaw);
      if (hours === null) {
        throw new HttpsError(
          "invalid-argument",
          status === "custom" ? "invalid_custom_hours" : "invalid_hours",
        );
      }
    }
    if (status === "custom") {
      if (hours === null || hours < 0 || hours > 24) {
        throw new HttpsError("invalid-argument", "invalid_custom_hours");
      }
    } else if (hours !== null && (hours < 0 || hours > 24)) {
      throw new HttpsError("invalid-argument", "invalid_hours");
    }

    if (date < minDay || date > today) {
      throw new HttpsError("invalid-argument", "date_out_of_range");
    }

    if (scope && scope.length > 0 && !scope.includes(driverId)) {
      throw new HttpsError("failed-precondition", "cell_out_of_scope");
    }

    cells.push({
      driverId,
      date,
      status,
      hours: status === "custom" ? hours : null,
      original: trimmedOrNull(cell.originalStatus ?? cell.original_status),
    });
  }

  const drivers = await loadDocMap(
    COLLECTIONS.drivers,
    cells.map((cell) => cell.driverId),
  );
  for (const cell of cells) {
    const driver = drivers.get(cell.driverId);
    if (!driver || driver["archived_at"]) {
      throw new HttpsError("failed-precondition", "unknown_driver");
    }
  }

  const actor = await actorName(db, staff.uid);
  const adjustedAt = Timestamp.now();
  const collection = db.collection(COLLECTIONS.payrollManualAdjustments);

  for (const group of chunk(cells, BATCH_LIMIT)) {
    const batch = db.batch();
    for (const cell of group) {
      batch.set(collection.doc(), {
        driver_id: cell.driverId,
        work_date: cell.date,
        period_month: monthDay(cell.date.slice(0, 7)),
        original_status: cell.original,
        adjusted_status: cell.status,
        adjusted_hours: cell.hours,
        reason,
        adjusted_by: staff.uid,
        adjusted_by_name: actor,
        adjusted_at: adjustedAt,
      });
    }
    await batch.commit();
  }

  await logRuleChange({
    db,
    actorId: staff.uid,
    actorName: actor,
    clientKey: null,
    periodMonth: null,
    entity: "adjustment",
    action: "apply",
    before: null,
    after: { cells: cells.length, reason, actor },
  });

  return { applied: cells.length, reason, by: actor };
});

/** `admin_payroll_adjustment_audit` — the change log, newest first. */
export const adminPayrollAdjustmentAudit = onCall(async (request) => {
  await requireStaff(request, "payroll.view");
  const data = argDict(request.data);
  const db = getFirestore();

  const from = pickDay(data, "p_from", "from");
  const to = pickDay(data, "p_to", "to");
  const driverId = pickId(data, "p_driver_id", "driverId");

  let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.payrollManualAdjustments);
  if (driverId) query = query.where("driver_id", "==", driverId);
  if (from) query = query.where("work_date", ">=", from);
  if (to) query = query.where("work_date", "<=", to);

  const snap = await query.limit(AUDIT_SCAN_CAP + 1).get();
  if (snap.size > AUDIT_SCAN_CAP) throw new HttpsError("out-of-range", "too_many_rows");

  const rows = snap.docs.map((doc) => ({ id: doc.id, data: (doc.data() ?? {}) as Dict }));
  const driverIds = rows
    .map((row) => asString(row.data["driver_id"]))
    .filter((id): id is string => Boolean(id));
  const [drivers, profiles] = await Promise.all([
    loadDocMap(COLLECTIONS.drivers, driverIds),
    loadDocMap(COLLECTIONS.profiles, driverIds),
  ]);

  return rows
    .sort(
      (a, b) =>
        (asDate(b.data["adjusted_at"])?.getTime() ?? 0) -
        (asDate(a.data["adjusted_at"])?.getTime() ?? 0),
    )
    .map(({ id, data: row }) => {
      const rowDriverId = asString(row["driver_id"]);
      const driver = rowDriverId ? drivers.get(rowDriverId) : undefined;
      const profile = rowDriverId ? profiles.get(rowDriverId) : undefined;
      return {
        id,
        driverId: rowDriverId,
        driverName: trimmedOrNull(profile?.["full_name"]) ?? trimmedOrNull(driver?.["name"]) ?? "—",
        mgId:
          trimmedOrNull(driver?.["employee_id"]) ?? trimmedOrNull(driver?.["driver_code"]) ?? "—",
        workDate: asString(row["work_date"]),
        originalStatus: asString(row["original_status"]),
        adjustedStatus: asString(row["adjusted_status"]),
        adjustedHours: numberOrNull(row["adjusted_hours"]),
        reason: asString(row["reason"]),
        actorName: asString(row["adjusted_by_name"]) ?? "—",
        adjustedAt: kuwaitMinuteString(row["adjusted_at"]),
      };
    });
});

// --- 2. month snapshot ----------------------------------------------------------

/**
 * `admin_payroll_month_snapshot` — the attendance-hours payroll month: one status
 * per driver-day (`blank` for future days, `work` when a check-in exists, then an
 * accident / sick / off request cover, else `absent`), plus request rows and KPIs.
 */
export const adminPayrollMonthSnapshot = onCall(async (request) => {
  await requireStaff(request, "payroll.view");
  const data = argDict(request.data);
  const db = getFirestore();

  const today = kuwaitDayString(new Date());
  const currentMonth = today.slice(0, 7);
  const month = requireMonthArg(data, "p_month", "month", "monthKey");
  if (monthIndex(month) < monthIndex(currentMonth) - 2 || monthIndex(month) > monthIndex(currentMonth)) {
    throw new HttpsError("failed-precondition", "month_out_of_range");
  }

  const slicers = {
    zoneIds: pickIdList(data, "p_zone_ids", "zoneIds"),
    projectKeys: pickIdList(data, "p_project_keys", "projectKeys"),
    vehicleKeys: pickIdList(data, "p_vehicle_keys", "vehicleKeys"),
    nationalities: pickIdList(data, "p_nationalities", "nationalities"),
    sourceTypes: pickIdList(data, "p_source_types", "sourceTypes"),
    sourceCompanies: pickIdList(data, "p_source_companies", "sourceCompanies"),
    restaurantIds: pickIdList(data, "p_restaurant_ids", "restaurantIds"),
  };

  const { year, month: monthNumber } = parseMonthKey(month);
  const days = daysInMonth(year, monthNumber);
  const fixed = days - DEFAULT_OFF_DAYS;
  const firstDay = monthDay(month);
  const lastDay = `${month}-${String(days).padStart(2, "0")}`;
  const dayGrid = kuwaitDayRange(firstDay, lastDay);

  const [driverSnap, zonesSnap, restaurantsSnap, attendanceSnap, offSnap, requestsSnap] =
    await Promise.all([
      db.collection(COLLECTIONS.drivers).where("archived_at", "==", null).get(),
      db.collection(COLLECTIONS.zones).get(),
      db.collection(COLLECTIONS.restaurants).get(),
      db
        .collection(COLLECTIONS.attendanceLogs)
        .where("log_date", ">=", firstDay)
        .where("log_date", "<=", lastDay)
        .limit(MONTH_SCAN_CAP + 1)
        .get(),
      db.collection(COLLECTIONS.driverOffStructure).where("period_month", "==", firstDay).get(),
      db
        .collection(COLLECTIONS.requests)
        .where("window_end_day", ">=", firstDay)
        .where("window_start_day", "<=", lastDay)
        .limit(MONTH_SCAN_CAP + 1)
        .get(),
    ]);
  if (attendanceSnap.size > MONTH_SCAN_CAP || requestsSnap.size > MONTH_SCAN_CAP) {
    throw new HttpsError("out-of-range", "too_many_rows");
  }

  const zoneNames = new Map<string, string>();
  for (const doc of zonesSnap.docs) {
    const name = asString(doc.get("name"));
    if (name) zoneNames.set(doc.id, name);
  }
  const restaurantNames = new Map<string, string | null>();
  for (const doc of restaurantsSnap.docs) restaurantNames.set(doc.id, asString(doc.get("name")));

  const vehicleIds = driverSnap.docs
    .map((doc) => asString(doc.get("vehicle_id")))
    .filter((id): id is string => Boolean(id));
  const vehicles = await loadDocMap(COLLECTIONS.vehicles, vehicleIds);

  type RosterRow = {
    id: string;
    name: string;
    employeeId: string | null;
    driverCode: string | null;
    zoneId: string | null;
    zoneName: string | null;
    projectKey: string | null;
    nationality: string | null;
    riderCategory: string | null;
    sourceCompany: string | null;
    status: string | null;
    vehicleKey: string | null;
    restaurantId: string | null;
    restaurantName: string | null;
  };

  const rosterAll: RosterRow[] = driverSnap.docs.map((doc) => {
    const raw = (doc.data() ?? {}) as Dict;
    const zoneId = asString(raw["zone_id"]);
    const projectKey = asString(raw["project_key"]);
    const restaurantId = firstRestaurantId(raw);
    const vehicleId = asString(raw["vehicle_id"]);
    const vehicle = vehicleId ? vehicles.get(vehicleId) : undefined;
    return {
      id: doc.id,
      name: trimmedOrNull(raw["name"]) ?? trimmedOrNull(raw["full_name"]) ?? "—",
      employeeId: trimmedOrNull(raw["employee_id"]),
      driverCode: trimmedOrNull(raw["driver_code"]),
      zoneId,
      zoneName: zoneId ? (zoneNames.get(zoneId) ?? asString(raw["zone_name"])) : null,
      projectKey,
      nationality: asString(raw["nationality"]),
      riderCategory: asString(raw["rider_category"]),
      sourceCompany: asString(raw["source_company"]),
      status: asString(raw["status"]),
      vehicleKey: vehicleId ? asString(vehicle?.["vehicle_type_key"]) : null,
      restaurantId,
      restaurantName:
        projectKey === "keeta" || !restaurantId ? null : (restaurantNames.get(restaurantId) ?? null),
    };
  });

  const roster = rosterAll.filter(
    (d) =>
      inList(slicers.projectKeys, d.projectKey) &&
      inList(slicers.zoneIds, d.zoneId) &&
      inList(slicers.vehicleKeys, d.vehicleKey) &&
      inList(slicers.nationalities, d.nationality) &&
      inList(slicers.sourceTypes, d.riderCategory) &&
      inList(slicers.sourceCompanies, d.sourceCompany) &&
      inList(slicers.restaurantIds, d.restaurantId),
  );
  const rosterById = new Map(roster.map((row) => [row.id, row]));

  const checkins = new Map<string, number>();
  for (const doc of attendanceSnap.docs) {
    const raw = (doc.data() ?? {}) as Dict;
    const driverId = asString(raw["driver_id"]);
    if (!driverId || !rosterById.has(driverId)) continue;
    const checkIn = asDate(raw["check_in_at"]);
    const day = checkIn ? kuwaitDayString(checkIn) : asString(raw["log_date"]);
    if (!day || day < firstDay || day > lastDay) continue;
    const checkOut = asDate(raw["check_out_at"]);
    const hours =
      checkIn && checkOut ? Math.max(0, (checkOut.getTime() - checkIn.getTime()) / 3_600_000) : 0;
    const key = `${driverId}|${day}`;
    checkins.set(key, (checkins.get(key) ?? 0) + hours);
  }

  const offStructure = new Map<string, { offDays: number; source: string }>();
  for (const doc of offSnap.docs) {
    const driverId = asString(doc.get("driver_id"));
    if (!driverId) continue;
    const offDays = numberOrNull(doc.get("off_days"));
    offStructure.set(driverId, {
      offDays: offDays ?? DEFAULT_OFF_DAYS,
      source: asString(doc.get("source")) ?? "default",
    });
  }

  type Cover = {
    accident: boolean;
    sick: boolean;
    off: boolean;
    approvedAccident: boolean;
    approvedSick: boolean;
    approvedOff: boolean;
  };
  const covers = new Map<string, Cover>();
  type RequestRow = {
    id: string;
    code: string | null;
    driverId: string;
    riderName: string;
    riderCode: string;
    tile: string;
    day: string;
    zone: string;
    partner: string;
    reviewingDept: string;
    liveStatus: string | null;
    uiStatus: string;
  };
  const requestRows: RequestRow[] = [];

  for (const doc of requestsSnap.docs) {
    const raw = (doc.data() ?? {}) as Dict;
    const driverId = asString(raw["driver_id"]);
    if (!driverId) continue;
    const created = asDate(raw["created_at"]);
    const createdDay = created ? kuwaitDayString(created) : null;
    const startDate =
      pickDay(raw, "start_date") ?? asString(raw["window_start_day"]) ?? createdDay;
    const endDate =
      pickDay(raw, "end_date") ??
      pickDay(raw, "start_date") ??
      asString(raw["window_end_day"]) ??
      createdDay;
    if (!startDate || !endDate) continue;
    if (startDate > lastDay || endDate < firstDay) continue;

    const requestType = asString(raw["request_type"]);
    const status = asString(raw["status"]);
    const payload = (raw["payload"] ?? {}) as Dict;
    const leaveType = String(payload["leave_type"] ?? "").trim().toLowerCase();
    const leaveSubtype = String(payload["leave_subtype"] ?? "").trim().toLowerCase();
    const isAccident =
      (requestType === "leave" && leaveType === "accident") ||
      (requestType === "sick_leave" && leaveSubtype === "accident");

    let tile: string | null = null;
    if (isAccident) tile = "accident";
    else if (requestType === "leave") tile = "leave";
    else if (requestType === "sick_leave") tile = "sick";
    else if (requestType === "fuel" || requestType === "fuel_refund") tile = "fuel";
    else if (
      requestType === "asset" ||
      requestType === "loan" ||
      requestType === "document" ||
      requestType === "salary_justification"
    ) {
      tile = requestType;
    }

    let cover: "accident" | "sick" | "off" | null = null;
    if (isAccident) cover = "accident";
    else if (requestType === "leave") cover = "off";
    else if (requestType === "sick_leave") cover = "sick";

    if (cover && rosterById.has(driverId)) {
      const approved = APPROVED_STATUSES.has(status ?? "");
      for (const day of dayGrid) {
        if (day < startDate || day > endDate) continue;
        const key = `${driverId}|${day}`;
        const entry = covers.get(key) ?? {
          accident: false,
          sick: false,
          off: false,
          approvedAccident: false,
          approvedSick: false,
          approvedOff: false,
        };
        if (cover === "accident") {
          entry.accident = true;
          entry.approvedAccident = entry.approvedAccident || approved;
        } else if (cover === "sick") {
          entry.sick = true;
          entry.approvedSick = entry.approvedSick || approved;
        } else {
          entry.off = true;
          entry.approvedOff = entry.approvedOff || approved;
        }
        covers.set(key, entry);
      }
    }

    const rider = rosterById.get(driverId);
    if (!tile || !rider) continue;
    const roleKey = trimmedOrNull(raw["current_step_role_key"]);
    requestRows.push({
      id: doc.id,
      code: asString(raw["request_code"]),
      driverId,
      riderName: rider.name,
      riderCode: rider.driverCode ?? rider.employeeId ?? "—",
      tile,
      day: startDate,
      zone: rider.zoneName ?? "—",
      partner: partnerLabel(rider.projectKey),
      reviewingDept:
        trimmedOrNull(raw["current_step_label"]) ??
        trimmedOrNull(raw["current_step_name"]) ??
        (roleKey ? (ROLE_LABELS[roleKey] ?? roleKey) : "—"),
      liveStatus: status,
      uiStatus: uiStatusOf(status),
    });
  }

  const riderRows = roster.map((d) => {
    const statuses: string[] = [];
    let workDays = 0;
    let offDays = 0;
    let sickDays = 0;
    let accidentDays = 0;
    let absentDays = 0;
    let unjustified = 0;
    let actualHours = 0;

    for (const day of dayGrid) {
      const key = `${d.id}|${day}`;
      const cover = covers.get(key);
      const worked = checkins.has(key);
      let status: string;
      let isUnjustified = false;
      if (day > today) {
        status = "blank";
      } else if (worked) {
        status = "work";
      } else if (cover?.accident) {
        status = "accident";
        isUnjustified = !cover.approvedAccident;
      } else if (cover?.sick) {
        status = "sick";
        isUnjustified = !cover.approvedSick;
      } else if (cover?.off) {
        status = "off";
        isUnjustified = !cover.approvedOff;
      } else {
        status = "absent";
      }
      statuses.push(status);
      actualHours += checkins.get(key) ?? 0;
      if (isUnjustified) unjustified += 1;
      if (status === "work") workDays += 1;
      else if (status === "off") offDays += 1;
      else if (status === "sick") sickDays += 1;
      else if (status === "accident") accidentDays += 1;
      else if (status === "absent") absentDays += 1;
    }

    const off = offStructure.get(d.id);
    const offStructureDays = off?.offDays ?? DEFAULT_OFF_DAYS;
    const requiredDays = days - offStructureDays;
    return {
      driverId: d.id,
      amId: d.employeeId ?? "—",
      mgId: d.driverCode ?? "—",
      name: d.name,
      restaurant:
        d.projectKey === "keeta" || !trimmedOrNull(d.restaurantName)
          ? "(Pool)"
          : (d.restaurantName as string),
      restaurantId: d.restaurantId,
      zone: d.zoneName ?? "—",
      zoneId: d.zoneId,
      partner: partnerLabel(d.projectKey),
      projectKey: d.projectKey,
      nationality: d.nationality ?? "—",
      nationalityCode: d.nationality,
      status: d.status === "active" ? "Active" : "Inactive",
      vehicleKey: d.vehicleKey,
      sourceType: d.riderCategory,
      sourceCompany: d.sourceCompany,
      days: statuses,
      workDays,
      totalHours: workDays * DAY_HOURS,
      offDays,
      sickDays,
      accidentDays,
      absentDays,
      fixedDays: fixed,
      offStructureDays,
      offStructureSource: off?.source ?? "default",
      offStructureHours: offStructureDays * DAY_HOURS,
      requiredHours: Math.max(0, requiredDays * DAY_HOURS),
      actualHours: round2(actualHours),
      efficiency: requiredDays <= 0 ? 0 : (actualHours / (requiredDays * DAY_HOURS)) * 100,
      unjustified,
    };
  });
  riderRows.sort((a, b) => a.name.localeCompare(b.name));

  const uiRank = (status: string) =>
    status === "pending" ? 0 : status === "under_review" ? 1 : status === "approved" ? 2 : 3;
  requestRows.sort((a, b) => uiRank(a.uiStatus) - uiRank(b.uiStatus) || a.day.localeCompare(b.day));

  const zoneOptions = new Map<string, string>();
  const restaurantOptions = new Map<string, string>();
  const nationalities = new Set<string>();
  const sourceCompanies = new Set<string>();
  for (const row of rosterAll) {
    if (row.zoneId && row.zoneName) zoneOptions.set(row.zoneId, row.zoneName);
    if (row.restaurantId && row.restaurantName && row.projectKey !== "keeta") {
      restaurantOptions.set(row.restaurantId, row.restaurantName);
    }
    if (row.nationality) nationalities.add(row.nationality);
    if (row.sourceCompany) sourceCompanies.add(row.sourceCompany);
  }

  const months = [0, -1, -2].map((delta) => {
    const key = shiftMonth(currentMonth, delta);
    const parsed = parseMonthKey(key);
    const monthDays = daysInMonth(parsed.year, parsed.month);
    return {
      key,
      year: parsed.year,
      month: parsed.month,
      days: monthDays,
      label: monthLabel(parsed.year, parsed.month),
      fixedDays: monthDays - DEFAULT_OFF_DAYS,
    };
  });

  const countStatus = (status: string) => requestRows.filter((row) => row.uiStatus === status).length;
  const totalRequests = requestRows.length;
  const approvedRequests = countStatus("approved");
  const riderCount = riderRows.length;

  return {
    today,
    month: {
      key: month,
      year,
      month: monthNumber,
      days,
      label: monthLabel(year, monthNumber),
      fixedDays: fixed,
      defaultOffDays: DEFAULT_OFF_DAYS,
      dayHours: DAY_HOURS,
    },
    months,
    options: {
      zones: [...zoneOptions]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      restaurants: [...restaurantOptions]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      nationalities: [...nationalities].sort(),
      sourceCompanies: [...sourceCompanies].sort(),
    },
    riders: riderRows,
    requests: requestRows,
    payrollKpis: {
      riders: riderCount,
      active: riderRows.filter((row) => row.status === "Active").length,
      avgEfficiency:
        riderCount === 0
          ? 0
          : riderRows.reduce((sum, row) => sum + row.efficiency, 0) / riderCount,
      atOrAbove100: riderRows.filter((row) => row.efficiency >= 100).length,
      unjustifiedRiders: riderRows.filter((row) => row.unjustified > 0).length,
    },
    requestKpis: {
      total: totalRequests,
      pending: countStatus("pending"),
      underReview: countStatus("under_review"),
      approved: approvedRequests,
      rejected: countStatus("rejected"),
      approvalRate: totalRequests === 0 ? 0 : (approvedRequests / totalRequests) * 100,
    },
    workflow: {
      awaitingAction: requestRows.filter(
        (row) => row.uiStatus === "pending" || row.uiStatus === "under_review",
      ).length,
      requestsPerRider:
        riderCount === 0 ? 0 : Math.round((totalRequests / riderCount) * 10) / 10,
    },
  };
});

function partnerLabel(projectKey: string | null): string {
  if (projectKey === "americana") return "Americana";
  if (projectKey === "keeta") return "Keeta";
  return "—";
}

function uiStatusOf(status: string | null): string {
  switch (status) {
    case "submitted":
      return "pending";
    case "rejected":
      return "rejected";
    case "approved":
    case "awaiting_driver_ack":
    case "solved":
    case "responded":
    case "closed":
      return "approved";
    default:
      return "under_review";
  }
}

// --- 3. zone settings -------------------------------------------------------------

/** `admin_payroll_zone_settings` — the month's global Target DPD override and thresholds. */
export const adminPayrollZoneSettings = onCall(async (request) => {
  await requireStaff(request, "payroll.view");
  const data = argDict(request.data);
  const db = getFirestore();
  const month = requireMonthArg(data, "p_month", "month", "monthKey");
  const periodMonth = monthDay(month);

  const [settingsSnap, metrics] = await Promise.all([
    db.collection(COLLECTIONS.payrollZoneSettings).doc(periodMonth).get(),
    zoneMetricsForMonth(db, periodMonth),
  ]);
  const settings = settingsSnap.exists ? ((settingsSnap.data() ?? {}) as Dict) : null;

  const dpds: number[] = [];
  for (const { data: row } of metrics.values()) {
    const riderDays = numberOrNull(row["rider_days"]) ?? 0;
    const dpd = numberOrNull(row["dpd"]);
    if (riderDays > 0 && dpd !== null) dpds.push(dpd);
  }

  return {
    periodMonth,
    targetDpdOverride: numberOrNull(settings?.["target_dpd_override"]),
    goodThreshold: numberOrNull(settings?.["good_threshold"]) ?? DEFAULT_GOOD,
    averageThreshold: numberOrNull(settings?.["average_threshold"]) ?? DEFAULT_AVERAGE,
    autoTargetDpd: dpds.length ? dpds.reduce((sum, value) => sum + value, 0) / dpds.length : null,
  };
});

/**
 * `admin_save_payroll_zone_settings` — upsert the month's settings, then re-band
 * every zone of that month against the new thresholds from the efficiency in force.
 */
export const adminSavePayrollZoneSettings = onCall(async (request) => {
  const staff = await requireStaff(request, "payroll.manage");
  requirePayrollManager(staff);
  const data = argDict(request.data);
  const db = getFirestore();

  const month = requireMonthArg(data, "p_month", "month", "monthKey");
  const periodMonth = monthDay(month);
  const targetRaw = pick(data, "p_target_dpd_override", "targetDpdOverride");
  const targetOverride = targetRaw === undefined ? null : numberOrNull(targetRaw);
  if (targetRaw !== undefined && targetOverride === null) {
    throw new HttpsError("invalid-argument", "invalid_target_dpd");
  }
  const good = round2(numberOrNull(pick(data, "p_good_threshold", "goodThreshold")) ?? DEFAULT_GOOD);
  const average = round2(
    numberOrNull(pick(data, "p_average_threshold", "averageThreshold")) ?? DEFAULT_AVERAGE,
  );
  if (good < 0 || average < 0 || good < average) {
    throw new HttpsError("invalid-argument", "invalid_thresholds");
  }

  const ref = db.collection(COLLECTIONS.payrollZoneSettings).doc(periodMonth);
  const beforeSnap = await ref.get();
  const before = beforeSnap.exists ? serialiseRow((beforeSnap.data() ?? {}) as Dict) : null;

  const row: Dict = {
    period_month: periodMonth,
    target_dpd_override: targetOverride === null ? null : round4(targetOverride),
    good_threshold: good,
    average_threshold: average,
    updated_at: Timestamp.now(),
    updated_by: staff.uid,
  };
  await ref.set(row);

  const metrics = await zoneMetricsForMonth(db, periodMonth);
  for (const group of chunk([...metrics.values()], BATCH_LIMIT)) {
    const batch = db.batch();
    for (const { ref: metricRef, data: metric } of group) {
      const efficiency =
        numberOrNull(metric["efficiency_override"]) ?? numberOrNull(metric["efficiency"]);
      batch.update(metricRef, {
        good_threshold: good,
        average_threshold: average,
        category_auto: zoneBand(efficiency, good, average),
      });
    }
    await batch.commit();
  }

  const after = serialiseRow(row);
  await logRuleChange({
    db,
    actorId: staff.uid,
    actorName: await actorName(db, staff.uid),
    clientKey: null,
    periodMonth,
    entity: "zone_settings",
    action: "update",
    before,
    after,
  });

  return after;
});

/**
 * `admin_save_payroll_zone_override` — every override is nullable and null means
 * "back to the computed value", which is also the reset path.
 */
export const adminSavePayrollZoneOverride = onCall(async (request) => {
  const staff = await requireStaff(request, "payroll.manage");
  requirePayrollManager(staff);
  const data = argDict(request.data);
  const db = getFirestore();

  const zoneId = pickId(data, "p_zone_id", "zoneId");
  const month = requireMonthArg(data, "p_month", "month", "monthKey");
  const periodMonth = monthDay(month);

  const categoryRaw = pickText(data, "p_category_override", "categoryOverride");
  const category = categoryRaw ? categoryRaw.toLowerCase() : null;
  if (category !== null && !ZONE_CATEGORIES.has(category)) {
    throw new HttpsError("invalid-argument", "invalid_zone_category");
  }

  const readNumber = (code: string, ...names: string[]): number | null => {
    const raw = pick(data, ...names);
    if (raw === undefined) return null;
    const value = numberOrNull(raw);
    if (value === null) throw new HttpsError("invalid-argument", code);
    return value;
  };
  const dpdUsed = readNumber("invalid_dpd", "p_dpd_used", "dpdUsed");
  const targetUsed = readNumber("invalid_target_dpd", "p_target_dpd_used", "targetDpdUsed");
  const efficiencyOverride = readNumber(
    "invalid_efficiency",
    "p_efficiency_override",
    "efficiencyOverride",
  );
  if (dpdUsed !== null && (dpdUsed < 0 || dpdUsed > MAX_DPD)) {
    throw new HttpsError("invalid-argument", "invalid_dpd");
  }
  if (targetUsed !== null && (targetUsed < 0 || targetUsed > MAX_DPD)) {
    throw new HttpsError("invalid-argument", "invalid_target_dpd");
  }
  if (efficiencyOverride !== null && (efficiencyOverride < 0 || efficiencyOverride > MAX_EFFICIENCY)) {
    throw new HttpsError("invalid-argument", "invalid_efficiency");
  }
  if (!zoneId || !(await db.collection(COLLECTIONS.zones).doc(zoneId).get()).exists) {
    throw new HttpsError("failed-precondition", "unknown_zone");
  }

  const [metricSnap, settingsSnap] = await Promise.all([
    db
      .collection(COLLECTIONS.payrollZoneMetrics)
      .where("zone_id", "==", zoneId)
      .where("period_month", "==", periodMonth)
      .limit(1)
      .get(),
    db.collection(COLLECTIONS.payrollZoneSettings).doc(periodMonth).get(),
  ]);
  if (metricSnap.empty) throw new HttpsError("failed-precondition", "zone_metrics_not_computed");

  const metricDoc = metricSnap.docs[0];
  const metric = (metricDoc.data() ?? {}) as Dict;
  const settings = settingsSnap.exists ? ((settingsSnap.data() ?? {}) as Dict) : null;
  const good =
    numberOrNull(settings?.["good_threshold"]) ??
    numberOrNull(metric["good_threshold"]) ??
    DEFAULT_GOOD;
  const average =
    numberOrNull(settings?.["average_threshold"]) ??
    numberOrNull(metric["average_threshold"]) ??
    DEFAULT_AVERAGE;

  const riderDays = numberOrNull(metric["rider_days"]) ?? 0;
  const targetDpd = numberOrNull(metric["target_dpd"]);
  let efficiency: number | null = null;
  if (riderDays > 0 && (targetDpd ?? 0) > 0) {
    const numerator = dpdUsed ?? numberOrNull(metric["dpd"]);
    const denominator = targetUsed ?? targetDpd;
    efficiency =
      numerator !== null && denominator !== null && denominator !== 0
        ? round4((numerator / denominator) * 100)
        : null;
  }

  const cleared =
    dpdUsed === null && targetUsed === null && efficiencyOverride === null && category === null;
  const update: Dict = {
    dpd_used: dpdUsed,
    target_dpd_used: targetUsed,
    efficiency_override: efficiencyOverride,
    category_override: category,
    override_by: cleared ? null : staff.uid,
    override_at: cleared ? null : Timestamp.now(),
    efficiency,
    category_auto: zoneBand(efficiencyOverride ?? efficiency, good, average),
  };
  await metricDoc.ref.update(update);

  const before = serialiseRow({ ...metric, zone_id: zoneId, period_month: periodMonth });
  const after = serialiseRow({ ...metric, ...update, zone_id: zoneId, period_month: periodMonth });
  await logRuleChange({
    db,
    actorId: staff.uid,
    actorName: await actorName(db, staff.uid),
    clientKey: null,
    periodMonth,
    entity: "zone_override",
    action: "update",
    before,
    after,
  });

  return after;
});

// --- 4. zone recompute ------------------------------------------------------------

/**
 * `admin_recompute_payroll_zone_metrics` — orders / rider days / DPD / target DPD /
 * auto category for one month (default: the previous completed Kuwait month).
 * Never writes `dpd_used`, `target_dpd_used` or `category_override`: a recompute
 * must not discard an Ops decision, so efficiency is re-derived through them.
 */
export const adminRecomputePayrollZoneMetrics = onCall(async (request) => {
  const staff = await requireStaff(request, "payroll.manage");
  requirePayrollManager(staff);
  const data = argDict(request.data);
  const db = getFirestore();

  const currentMonth = currentKuwaitMonth();
  const requested = pick(data, "p_month", "month", "monthKey");
  const month =
    requested === undefined ? shiftMonth(currentMonth, -1) : parseMonthArg(data, "p_month", "month", "monthKey");
  if (!month) throw new HttpsError("invalid-argument", "invalid_month");
  if (
    monthIndex(month) > monthIndex(currentMonth) ||
    monthIndex(month) < monthIndex(currentMonth) - RECOMPUTE_WINDOW_MONTHS
  ) {
    throw new HttpsError("failed-precondition", "month_out_of_range");
  }

  const periodMonth = monthDay(month);
  const { year, month: monthNumber } = parseMonthKey(month);
  const lastDay = `${month}-${String(daysInMonth(year, monthNumber)).padStart(2, "0")}`;

  const [clientsSnap, zonesSnap, driversSnap, restaurantsSnap, rowsSnap] = await Promise.all([
    db.collection(COLLECTIONS.payrollClients).where("is_active", "==", true).get(),
    db.collection(COLLECTIONS.zones).get(),
    db.collection(COLLECTIONS.drivers).where("archived_at", "==", null).get(),
    db.collection(COLLECTIONS.restaurants).get(),
    db
      .collection(COLLECTIONS.orderReconRows)
      .where("work_date", ">=", periodMonth)
      .where("work_date", "<=", lastDay)
      .limit(MONTH_SCAN_CAP + 1)
      .get(),
  ]);
  if (rowsSnap.size > MONTH_SCAN_CAP) throw new HttpsError("out-of-range", "too_many_rows");

  const thresholdClient = clientsSnap.docs
    .map((doc) => ({ key: asString(doc.get("key")) ?? doc.id, raw: (doc.data() ?? {}) as Dict }))
    .sort((a, b) => {
      const zoneA = a.raw["uses_zone"] === true ? 1 : 0;
      const zoneB = b.raw["uses_zone"] === true ? 1 : 0;
      if (zoneA !== zoneB) return zoneB - zoneA;
      const orderA = numberOrNull(a.raw["sort_order"]) ?? 100;
      const orderB = numberOrNull(b.raw["sort_order"]) ?? 100;
      if (orderA !== orderB) return orderA - orderB;
      return a.key.localeCompare(b.key);
    })[0];
  const good = numberOrNull(thresholdClient?.raw["good_threshold"]) ?? DEFAULT_GOOD;
  const average = numberOrNull(thresholdClient?.raw["average_threshold"]) ?? DEFAULT_AVERAGE;

  // Newest applied run per (MG ID, day), then that run's orders for the pair.
  const runIds = [
    ...new Set(
      rowsSnap.docs
        .map((doc) => asString(doc.get("run_id")))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const runs = await loadDocMap(COLLECTIONS.orderReconRuns, runIds);

  const latestRun = new Map<string, { runId: string; createdAt: number }>();
  for (const doc of rowsSnap.docs) {
    const raw = (doc.data() ?? {}) as Dict;
    const mgId = trimmedOrNull(raw["employee_id"])?.toLowerCase();
    const workDate = asString(raw["work_date"]);
    const runId = asString(raw["run_id"]);
    if (!mgId || !workDate || !runId) continue;
    const run = runs.get(runId);
    if (!run || run["status"] !== "applied") continue;
    const createdAt = asDate(run["created_at"])?.getTime() ?? 0;
    const key = `${mgId}|${workDate}`;
    const existing = latestRun.get(key);
    if (!existing || createdAt > existing.createdAt) latestRun.set(key, { runId, createdAt });
  }

  const ordersByMgDay = new Map<string, number>();
  for (const doc of rowsSnap.docs) {
    const raw = (doc.data() ?? {}) as Dict;
    const mgId = trimmedOrNull(raw["employee_id"])?.toLowerCase();
    const workDate = asString(raw["work_date"]);
    const runId = asString(raw["run_id"]);
    if (!mgId || !workDate || !runId) continue;
    const key = `${mgId}|${workDate}`;
    if (latestRun.get(key)?.runId !== runId) continue;
    ordersByMgDay.set(key, (ordersByMgDay.get(key) ?? 0) + (numberOrNull(raw["excel_orders"]) ?? 0));
  }

  const restaurantZone = new Map<string, string | null>();
  for (const doc of restaurantsSnap.docs) restaurantZone.set(doc.id, asString(doc.get("zone_id")));

  const zonesByMgId = new Map<string, Array<string | null>>();
  for (const doc of driversSnap.docs) {
    const raw = (doc.data() ?? {}) as Dict;
    const mgId = trimmedOrNull(raw["employee_id"])?.toLowerCase();
    if (!mgId) continue;
    const driverZone = asString(raw["zone_id"]);
    let zoneId = driverZone;
    if (asString(raw["project_key"]) === "americana") {
      const restaurantZoneId = sortedRestaurantIds(raw)
        .map((id) => restaurantZone.get(id) ?? null)
        .find((id): id is string => Boolean(id));
      zoneId = restaurantZoneId ?? driverZone;
    }
    const list = zonesByMgId.get(mgId) ?? [];
    list.push(zoneId);
    zonesByMgId.set(mgId, list);
  }

  const scan = new Map<string, { orders: number; riderDays: number }>();
  for (const [key, orders] of ordersByMgDay) {
    if (orders < 1) continue;
    const mgId = key.slice(0, key.lastIndexOf("|"));
    for (const zoneId of zonesByMgId.get(mgId) ?? []) {
      if (!zoneId) continue;
      const entry = scan.get(zoneId) ?? { orders: 0, riderDays: 0 };
      entry.orders += orders;
      entry.riderDays += 1;
      scan.set(zoneId, entry);
    }
  }

  const zoneDpds = [...scan.values()]
    .filter((entry) => entry.riderDays > 0)
    .map((entry) => entry.orders / entry.riderDays);
  const target = zoneDpds.length
    ? zoneDpds.reduce((sum, value) => sum + value, 0) / zoneDpds.length
    : null;

  const existing = await zoneMetricsForMonth(db, periodMonth);
  const computedAt = Timestamp.now();
  const writes: Array<{ ref: DocumentReference; data: Dict; merge: boolean }> = [];

  for (const zone of zonesSnap.docs) {
    const entry = scan.get(zone.id);
    const orders = entry?.orders ?? 0;
    const riderDays = entry?.riderDays ?? 0;
    const rawDpd = riderDays > 0 ? orders / riderDays : null;
    const current = existing.get(zone.id);
    const dpdUsed = numberOrNull(current?.data["dpd_used"]);
    const targetUsed = numberOrNull(current?.data["target_dpd_used"]);

    const denominator = targetUsed ?? target;
    let efficiency: number | null = null;
    if (riderDays > 0 && denominator !== null && denominator > 0) {
      const numerator = dpdUsed ?? (rawDpd as number);
      efficiency = (numerator / denominator) * 100;
    }

    const computed: Dict = {
      zone_id: zone.id,
      period_month: periodMonth,
      orders,
      rider_days: riderDays,
      dpd: rawDpd === null ? null : round4(rawDpd),
      target_dpd: target === null ? null : round4(target),
      good_threshold: good,
      average_threshold: average,
      efficiency: efficiency === null ? null : round4(efficiency),
      category_auto: zoneBand(efficiency, good, average),
      computed_at: computedAt,
    };

    if (current) {
      writes.push({ ref: current.ref, data: computed, merge: true });
    } else {
      writes.push({
        ref: db.collection(COLLECTIONS.payrollZoneMetrics).doc(zoneMetricDocId(zone.id, periodMonth)),
        data: {
          ...computed,
          dpd_used: null,
          target_dpd_used: null,
          efficiency_override: null,
          category_override: null,
          override_by: null,
          override_at: null,
        },
        merge: false,
      });
    }
  }

  for (const group of chunk(writes, BATCH_LIMIT)) {
    const batch = db.batch();
    for (const write of group) {
      if (write.merge) batch.set(write.ref, write.data, { merge: true });
      else batch.set(write.ref, write.data);
    }
    await batch.commit();
  }

  await logRuleChange({
    db,
    actorId: staff.uid,
    actorName: await actorName(db, staff.uid),
    clientKey: null,
    periodMonth,
    entity: "zone_metrics",
    action: "recompute",
    before: null,
    after: { zones: writes.length, targetDpd: target },
  });

  return {
    month: periodMonth,
    zones: writes.length,
    targetDpd: target,
    goodThreshold: good,
    averageThreshold: average,
  };
});
