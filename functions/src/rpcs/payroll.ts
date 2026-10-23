import type { QuerySnapshot } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { measureOnCall } from "../core/fs-metrics";
import { getFirestore, Timestamp, type DocumentSnapshot } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { daysInMonth, kuwaitDayString, monthKey, monthLabel, parseMonthKey } from "../core/kuwait";
import { parseIdList } from "../core/query";
import { loadAppSettings } from "../core/settings";
import { requireStaff, type StaffContext } from "../core/staff";
import { logPhases, timedPhase, type PhaseMarks } from "../perf/phase-log";
import { PAYROLL_ATTENDANCE_FIELDS, PAYROLL_RECON_FIELDS, payrollHoursFromFields } from "./payroll-read-plan";
import { isKeetaProjectKey } from "./_shared";
import { applyPayrollManualOrders } from "./payroll-edits";

const DAY_MS = 24 * 60 * 60 * 1000;
const GET_ALL_CHUNK = 300;

/** A month of attendance for 900 riders is ~27k rows; the SQL read the same. */
const SCAN_CAP = 40_000;

/** `payroll_month_snapshot`'s legacy duty day, used as the client fallback. */
const DEFAULT_DAY_HOURS = 12;
const DEFAULT_OFF_DAYS = 2;

const MONTH_RE = /^\d{4}-\d{2}$/;

type Slicers = {
  zoneIds: string[] | null;
  projectKeys: string[] | null;
  vehicleKeys: string[] | null;
  nationalities: string[] | null;
  sourceTypes: string[] | null;
  sourceCompanies: string[] | null;
  restaurantIds: string[] | null;
};

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

function restaurantIdsOf(raw: Record<string, unknown>): string[] {
  const single = trimmedOrNull(raw["restaurant_id"]);
  const list = Array.isArray(raw["restaurant_ids"])
    ? (raw["restaurant_ids"] as unknown[]).filter((id): id is string => typeof id === "string")
    : [];
  const ids: string[] = [];
  if (single) ids.push(single);
  for (const id of [...list].sort((a, b) => a.localeCompare(b))) {
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Every restaurant a rider could be assigned to, denormalised copy first and
 * edge rows second. The grid used to take only the denormalised first id, so a
 * rider whose copy pointed at a missing document printed "(Pool)" even when a
 * live `driver_restaurants` edge named a real restaurant.
 */
function restaurantCandidates(raw: Record<string, unknown>, edgeIds: string[] = []): string[] {
  const ids = restaurantIdsOf(raw);
  for (const id of edgeIds) if (!ids.includes(id)) ids.push(id);
  return ids;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => trimmedOrNull(item))
        .filter((item): item is string => Boolean(item))
    : [];
}

/**
 * `drivers` holds `full_name`; older intake-shaped rows held `name`, and a
 * rider approved from an intake can hold the name only on `profiles.full_name`.
 * The payroll grid must never print a dash — or a bare employee id — for a
 * rider who has a real name on any of them.
 */
function driverDisplayName(
  raw: Record<string, unknown>,
  profileName?: string | null,
): string | null {
  return (
    trimmedOrNull(raw["name"]) ??
    trimmedOrNull(raw["full_name"]) ??
    trimmedOrNull(raw["driver_name"]) ??
    trimmedOrNull(profileName) ??
    trimmedOrNull(raw["employee_id"]) ??
    trimmedOrNull(raw["driver_code"])
  );
}

/** First assigned restaurant name, used when the restaurant doc is unavailable. */
function firstRestaurantName(raw: Record<string, unknown>): string | null {
  const single = trimmedOrNull(raw["restaurant_name"]);
  if (single) return single;
  const list = asStringList(raw["restaurant_names"]);
  if (!list.length) return null;
  return [...list].sort((a, b) => a.localeCompare(b))[0];
}

/** The Kuwait midnight → next midnight window of a `YYYY-MM` month. */
function monthBounds(key: string): { start: Date; end: Date; days: number } {
  const { year, month } = parseMonthKey(key);
  const start = new Date(Date.UTC(year, month - 1, 1) - 3 * 60 * 60 * 1000);
  const end = new Date(Date.UTC(year, month, 1) - 3 * 60 * 60 * 1000);
  return { start, end, days: daysInMonth(year, month) };
}

function shiftMonth(key: string, delta: number): string {
  const { year, month } = parseMonthKey(key);
  const index = year * 12 + (month - 1) + delta;
  return monthKey(Math.floor(index / 12), (index % 12) + 1);
}

/** The three months the picker offers, newest first — the SQL's `ORDER BY m DESC`. */
function monthOptions(currentKey: string) {
  const out = [];
  for (let back = 0; back <= 2; back += 1) {
    const key = shiftMonth(currentKey, -back);
    const { year, month } = parseMonthKey(key);
    const days = daysInMonth(year, month);
    out.push({
      key,
      year,
      month,
      days,
      label: monthLabel(year, month),
      fixedDays: days - DEFAULT_OFF_DAYS,
    });
  }
  return out;
}

function dayStringsBetween(from: string, to: string): string[] {
  const parse = (day: string) => {
    const [y, m, d] = day.split("-").map((part) => Number(part));
    return Date.UTC(y, m - 1, d);
  };
  const out: string[] = [];
  let cursor = parse(from);
  const end = parse(to);
  while (cursor <= end) {
    out.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += DAY_MS;
  }
  return out;
}

/**
 * `admin_payroll_rule_snapshot`.
 *
 * The shape is the RPC's, key for key: `riders[].days[]` carries the *raw per-day
 * inputs* (`h`, `o`, `k`, `c`, `ca`, `x`, `xh`) and never a status, because the
 * client's `payroll-rules-engine.ts` is the only place a day is decided. A handler
 * that resolved a status here would be a second engine, and the two would drift
 * the first time a threshold moved.
 */
export const adminPayrollRuleSnapshot = measureOnCall("adminPayrollRuleSnapshot", async (request) => {
  const phases: PhaseMarks = {};
  try {
  const staff = await timedPhase(phases, "requireStaffMs", () => requireStaff(request, "payroll.view"));
  const data = (request.data ?? {}) as Record<string, unknown>;

  const today = kuwaitDayString(new Date());
  const currentKey = today.slice(0, 7);
  const requested = typeof data.month === "string" ? data.month.slice(0, 7) : currentKey;
  if (!MONTH_RE.test(requested)) throw new HttpsError("invalid-argument", "invalid_month");

  // The same window the Payroll page allows, so a month the grid cannot show is
  // refused rather than answered with a partial one.
  const allowed = [shiftMonth(currentKey, -2), shiftMonth(currentKey, -1), currentKey];
  if (!allowed.includes(requested)) {
    throw new HttpsError("failed-precondition", "month_out_of_range");
  }

  const slicers: Slicers = {
    zoneIds: parseIdList(data.zoneIds),
    projectKeys: parseIdList(data.projectKeys),
    vehicleKeys: parseIdList(data.vehicleKeys),
    nationalities: parseIdList(data.nationalities),
    sourceTypes: parseIdList(data.sourceTypes),
    sourceCompanies: parseIdList(data.sourceCompanies),
    restaurantIds: parseIdList(data.restaurantIds),
  };

  const month = requested;
  const zoneMonth = shiftMonth(month, -1);
  const { start, end, days } = monthBounds(month);
  const lastDay = kuwaitDayString(new Date(end.getTime() - 1));
  const settings = await loadAppSettings();

  const ctx = await loadPayrollContext({ month, zoneMonth, start, end, lastDay, days, settings, phases });
  return buildSnapshot(ctx, slicers, staff);
  } finally {
    logPhases("adminPayrollRuleSnapshot", phases);
  }
});

type PayrollContext = Awaited<ReturnType<typeof loadPayrollContext>>;

async function loadPayrollContext(input: {
  month: string;
  zoneMonth: string;
  start: Date;
  end: Date;
  lastDay: string;
  days: number;
  settings: Awaited<ReturnType<typeof loadAppSettings>>;
  phases?: PhaseMarks;
}) {
  const db = getFirestore();
  const { month, zoneMonth, start, lastDay, days } = input;
  const phases = input.phases ?? {};
  const firstDay = kuwaitDayString(start);

  const [driverSnap, attendanceSnap, clientsSnap, zonesSnap, restaurantsSnap, adjustmentsSnap, offSnap, orderSnap] =
    await timedPhase(phases, "fanoutMs", () => Promise.all([
      db.collection(COLLECTIONS.drivers).where("archived_at", "==", null).get(),
      db
        .collection(COLLECTIONS.attendanceLogs)
        .where("log_date", ">=", firstDay)
        .where("log_date", "<=", lastDay)
        .select(...PAYROLL_ATTENDANCE_FIELDS)
        .limit(SCAN_CAP)
        .get(),
      db.collection(COLLECTIONS.payrollClients).where("is_active", "==", true).get(),
      db.collection(COLLECTIONS.zones).get(),
      db.collection(COLLECTIONS.restaurants).get(),
      db
        .collection(COLLECTIONS.payrollManualAdjustments)
        .where("work_date", ">=", firstDay)
        .where("work_date", "<=", lastDay)
        .get(),
      db.collection(COLLECTIONS.driverOffStructure).where("period_month", "==", `${month}-01`).get(),
      db
        .collection(COLLECTIONS.payrollOrderOverrides)
        .where("work_date", ">=", firstDay)
        .where("work_date", "<=", lastDay)
        .get(),
    ]));

  const clientKeys = clientsSnap.docs
    .map((doc) => asString(doc.get("key")))
    .filter((key): key is string => Boolean(key));

  const ruleQueries: Array<Promise<QuerySnapshot>> = [];
  for (let index = 0; index < clientKeys.length; index += 30) {
    ruleQueries.push(
      db
        .collection(COLLECTIONS.payrollClientRules)
        .where("client_key", "in", clientKeys.slice(index, index + 30))
        .get(),
    );
  }
  const rulesSnaps = await timedPhase(phases, "rulesMs", () => Promise.all(ruleQueries));

  const [metricsSnap, requestsSnap] = await timedPhase(phases, "metricsMs", () => Promise.all([
    db
      .collection(COLLECTIONS.payrollZoneMetrics)
      .where("period_month", "==", `${zoneMonth}-01`)
      .get(),
    // Requests are bounded by their own window, not the month's: a leave that
    // started last month still covers days inside this one, so the lower bound
    // reaches back far enough for a long request to be seen.
    db
      .collection(COLLECTIONS.requests)
      .where("window_end_day", ">=", firstDay)
      .where("window_start_day", "<=", lastDay)
      .limit(SCAN_CAP)
      .get(),
  ]));

  // `drivers` does not always carry the rider's name — a rider approved from an
  // intake can hold the name only on `profiles.full_name` — so the roster's
  // name, and the AO grid's rider column for app-created requests, both read
  // this map before falling back to the employee id.
  const driverIds = driverSnap.docs.map((doc) => doc.id);
  const profileIds = [
    ...new Set([
      ...driverIds,
      ...requestsSnap.docs
        .map((doc) => asString(doc.get("driver_id")))
        .filter((id): id is string => Boolean(id)),
    ]),
  ];
  const profileNames = new Map<string, string>();
  for (let index = 0; index < profileIds.length; index += GET_ALL_CHUNK) {
    const chunk = profileIds.slice(index, index + GET_ALL_CHUNK);
    const snaps = await db.getAll(
      ...chunk.map((id) => db.collection(COLLECTIONS.profiles).doc(id)),
    );
    for (const snap of snaps) {
      const name = trimmedOrNull((snap.data() ?? {})["full_name"]);
      if (name) profileNames.set(snap.id, name);
    }
  }

  const [recon, verifiedByDriverDay] = await timedPhase(phases, "reconMs", () =>
    Promise.all([
      loadReconOrders(firstDay, lastDay),
      loadVerifiedByDriverDay(firstDay, lastDay, monthKeysInclusive(firstDay, lastDay)),
    ]),
  );

  const restaurantById = new Map<string, Record<string, unknown>>();
  for (const doc of restaurantsSnap.docs) restaurantById.set(doc.id, doc.data());

  // Restaurant assignment for a linked rider lives in `driver_restaurants`
  // edges, not on `drivers` — the payroll grid read only the denormalised copy,
  // so every row whose assignment predates that copy printed "(Pool)".
  const driverRestaurantIds = new Map<string, string[]>();
  const edgeQueries: Array<Promise<QuerySnapshot>> = [];
  for (let index = 0; index < driverIds.length; index += 30) {
    edgeQueries.push(
      db
        .collection(COLLECTIONS.driverRestaurants)
        .where("driver_id", "in", driverIds.slice(index, index + 30))
        .get(),
    );
  }
  if (edgeQueries.length) {
    const edgeSnaps = await timedPhase(phases, "restaurantEdgesMs", () => Promise.all(edgeQueries));
    for (const snap of edgeSnaps) {
      for (const doc of snap.docs) {
        const driverId = asString(doc.get("driver_id"));
        const restaurantId = asString(doc.get("restaurant_id"));
        if (!driverId || !restaurantId) continue;
        const list = driverRestaurantIds.get(driverId) ?? [];
        if (!list.includes(restaurantId)) list.push(restaurantId);
        driverRestaurantIds.set(driverId, list);
      }
    }
  }

  const offStructure = new Map<string, { offDays: number; source: string }>();
  for (const doc of offSnap.docs) {
    const driverId = asString(doc.get("driver_id"));
    if (!driverId) continue;
    offStructure.set(driverId, {
      offDays: asNumber(doc.get("off_days"), DEFAULT_OFF_DAYS),
      source: asString(doc.get("source")) ?? "manual",
    });
  }

  const workedByDriverDay = new Map<string, number>();
  for (const doc of attendanceSnap.docs) {
    const driverId = asString(doc.get("driver_id"));
    const logDate = asString(doc.get("log_date"));
    if (!driverId || !logDate) continue;
    const key = `${driverId}|${logDate}`;
    workedByDriverDay.set(key, (workedByDriverDay.get(key) ?? 0) + hoursFromLog(doc));
  }

  // Newest adjustment per (driver, day), because the table is append-only and an
  // 'auto' row is a revert rather than a delete. Equal timestamps break on the
  // document id, so two applies a millisecond apart cannot make the winning cell
  // depend on the order Firestore happened to return them in.
  const adjustmentByDriverDay = new Map<string, Record<string, unknown>>();
  const adjustmentStamp = new Map<string, { at: number; id: string }>();
  for (const doc of adjustmentsSnap.docs) {
    const raw = doc.data();
    const driverId = asString(raw["driver_id"]);
    const workDate = asString(raw["work_date"]);
    if (!driverId || !workDate) continue;
    const key = `${driverId}|${workDate}`;
    const at = asDate(raw["adjusted_at"])?.getTime() ?? 0;
    const held = adjustmentStamp.get(key);
    if (held && (held.at > at || (held.at === at && held.id > doc.id))) continue;
    adjustmentStamp.set(key, { at, id: doc.id });
    adjustmentByDriverDay.set(key, raw);
  }

  const manualOrders = new Map<string, number>();
  for (const doc of orderSnap.docs) {
    const driverId = asString(doc.get("driver_id"));
    const workDate = asString(doc.get("work_date"));
    const orders = nullableNumber(doc.get("orders"));
    if (!driverId || !workDate || orders == null) continue;
    manualOrders.set(`${driverId}|${workDate}`, orders);
  }

  return {
    month,
    zoneMonth,
    firstDay,
    lastDay,
    days,
    today: kuwaitDayString(new Date()),
    settings: input.settings,
    driverSnap,
    clientsSnap,
    zonesSnap,
    restaurantById,
    driverRestaurantIds,
    rulesSnaps,
    metricsSnap,
    requestsSnap,
    recon,
    verifiedByDriverDay,
    offStructure,
    workedByDriverDay,
    adjustmentByDriverDay,
    manualOrders,
    profileNames,
  };
}

/**
 * Hours for a closed log, `0` for one still open.
 *
 * An open log crediting its elapsed time would inflate the month by a shift that
 * has not ended. The grid is shown the elapsed figure separately as display-only
 * (`loadOpenLogElapsedToday` on the client) and the rule engine keeps seeing 0,
 * which is the same split the SQL depended on.
 */
function hoursFromLog(doc: DocumentSnapshot): number {
  return payrollHoursFromFields(doc.data() ?? {});
}

function monthKeysInclusive(firstDay: string, lastDay: string): string[] {
  const keys: string[] = [];
  let cursor = firstDay.slice(0, 7);
  const end = lastDay.slice(0, 7);
  while (cursor <= end) {
    keys.push(cursor);
    const [year, month] = cursor.split("-").map(Number);
    cursor =
      month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  }
  return keys;
}

function reconOrdersFor(
  recon: Map<string, { orders: number; createdAt: number }>,
  date: string,
  ...ids: Array<string | null | undefined>
): number | null {
  for (const id of ids) {
    const key = id?.trim().toLowerCase();
    if (!key) continue;
    const hit = recon.get(`${key}|${date}`);
    if (hit) return hit.orders;
  }
  return null;
}

async function loadVerifiedByDriverDay(
  firstDay: string,
  lastDay: string,
  months: readonly string[],
) {
  const db = getFirestore();
  try {
    const snaps = await Promise.all(
      months.map((month) =>
        db
          .collection(COLLECTIONS.rollupsDriverDay)
          .where("month", "==", month)
          .select("driver_id", "day", "verified")
          .limit(SCAN_CAP)
          .get(),
      ),
    );
    const map = new Map<string, number>();
    for (const snap of snaps) {
      for (const doc of snap.docs) {
        const driverId = asString(doc.get("driver_id"));
        const day = asString(doc.get("day"));
        if (!driverId || !day || day < firstDay || day > lastDay) continue;
        map.set(`${driverId}|${day}`, asNumber(doc.get("verified")));
      }
    }
    return map;
  } catch {
    return new Map<string, number>();
  }
}

/**
 * The newest *applied* reconciliation run per MG ID and day.
 *
 * `order_recon_rows` is append-only across runs and a run only counts once it is
 * applied, so the row that wins is the one from the applied run with the latest
 * `created_at`; summing every row would let a discarded upload overwrite a
 * committed one.
 */
async function loadReconOrders(firstDay: string, lastDay: string) {
  const db = getFirestore();
  const rowsSnap = await db
    .collection(COLLECTIONS.orderReconRows)
    .where("work_date", ">=", firstDay)
    .where("work_date", "<=", lastDay)
    .select(...PAYROLL_RECON_FIELDS)
    .limit(SCAN_CAP)
    .get();

  const runIds = [...new Set(
    rowsSnap.docs
      .map((doc) => asString(doc.get("run_id")))
      .filter((id): id is string => Boolean(id)),
  )];

  const runCreatedAt = new Map<string, number>();
  const runIsApplied = new Map<string, boolean>();
  for (let index = 0; index < runIds.length; index += GET_ALL_CHUNK) {
    const chunk = runIds.slice(index, index + GET_ALL_CHUNK);
    const snaps = await db.getAll(...chunk.map((id) => db.collection("order_recon_runs").doc(id)));
    for (const snap of snaps) {
      const raw = snap.data() ?? {};
      runIsApplied.set(snap.id, raw["status"] === "applied");
      runCreatedAt.set(snap.id, asDate(raw["created_at"])?.getTime() ?? 0);
    }
  }

  const best = new Map<string, { orders: number; createdAt: number }>();
  for (const doc of rowsSnap.docs) {
    const raw = doc.data();
    const employeeId = trimmedOrNull(raw["employee_id"])?.toLowerCase();
    const workDate = asString(raw["work_date"]);
    const runId = asString(raw["run_id"]);
    if (!employeeId || !workDate || !runId || !runIsApplied.get(runId)) continue;

    const key = `${employeeId}|${workDate}`;
    const createdAt = runCreatedAt.get(runId) ?? 0;
    const orders = asNumber(raw["excel_orders"]);
    const existing = best.get(key);
    if (!existing || createdAt > existing.createdAt) {
      best.set(key, { orders, createdAt });
    } else if (createdAt === existing.createdAt) {
      best.set(key, { orders: existing.orders + orders, createdAt });
    }
  }

  return best;
}

const ROLE_LABELS: Record<string, string> = {
  reporting_manager: "Reporting Manager",
  manager: "Reporting Manager",
  hr: "HR",
  payroll: "Payroll",
  fleet: "Fleet",
  operations: "Operations",
  finance: "Finance",
};

const APPROVED_STATUSES = new Set(["approved", "awaiting_driver_ack"]);

function coverOf(requestType: string | null, payload: Record<string, unknown>): string | null {
  const leaveType = String(payload["leave_type"] ?? "").trim().toLowerCase();
  const leaveSubtype = String(payload["leave_subtype"] ?? "").trim().toLowerCase();
  if (requestType === "leave" && leaveType === "accident") return "accident";
  if (requestType === "sick_leave" && leaveSubtype === "accident") return "accident";
  if (requestType === "leave") return "off";
  if (requestType === "sick_leave") return "sick";
  return null;
}

function tileOf(requestType: string | null): string | null {
  if (requestType === "leave" || requestType === "sick_leave") return requestType;
  if (requestType === "fuel" || requestType === "fuel_refund") return "fuel";
  if (
    requestType === "asset" ||
    requestType === "loan" ||
    requestType === "document" ||
    requestType === "salary_justification"
  ) {
    return requestType;
  }
  return null;
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

function inList(list: string[] | null, value: string | null): boolean {
  if (!list || list.length === 0) return true;
  return value !== null && list.includes(value);
}

function buildSnapshot(ctx: PayrollContext, slicers: Slicers, staff: StaffContext) {
  const { month, days, settings } = ctx;

  const zoneNames = new Map<string, string>();
  for (const doc of ctx.zonesSnap.docs) zoneNames.set(doc.id, asString(doc.get("name")) ?? "—");

  const zoneMetrics = ctx.metricsSnap.docs.map((doc) => {
    const raw = doc.data();
    const zoneId = asString(raw["zone_id"]) ?? doc.id;
    const dpd = nullableNumber(raw["dpd"]);
    const targetDpd = nullableNumber(raw["target_dpd"]);
    // An unmeasured zone is `not_set`, never 0 — a null denominator must not be
    // divided, and a zone nobody measured is not a bad zone.
    const dpdUsed = nullableNumber(raw["dpd_used"]) ?? dpd;
    const targetUsed = nullableNumber(raw["target_dpd_used"]) ?? targetDpd;
    return {
      zoneId,
      zoneName: asString(raw["zone_name"]) ?? zoneNames.get(zoneId) ?? "—",
      orders: asNumber(raw["orders"]),
      riderDays: asNumber(raw["rider_days"]),
      dpd,
      targetDpd,
      dpdUsed,
      targetDpdUsed: targetUsed,
      efficiency: dpdUsed !== null && targetUsed ? (dpdUsed / targetUsed) * 100 : null,
      categoryAuto: asString(raw["category_auto"]),
      categoryOverride: asString(raw["category_override"]),
      goodThreshold: asNumber(raw["good_threshold"], settings.payroll_zone_efficiency_good),
      averageThreshold: asNumber(raw["average_threshold"], settings.payroll_zone_efficiency_low),
      computedAt: asString(raw["computed_at"]),
    };
  });

  // `payroll_effective_rules`: the month's own rules, else the latest earlier
  // month's, so the grid can resolve a month Settings has never been opened on.
  const latestByClient = new Map<string, string>();
  const allRules = ctx.rulesSnaps.flatMap((snap) => snap.docs);
  for (const doc of allRules) {
    const clientKey = asString(doc.get("client_key"));
    const periodMonth = asString(doc.get("period_month"));
    if (!clientKey || !periodMonth) continue;
    if (periodMonth.slice(0, 7) > month) continue;
    const existing = latestByClient.get(clientKey);
    if (!existing || periodMonth > existing) latestByClient.set(clientKey, periodMonth);
  }
  const rules = allRules
    .filter((doc) => {
      const clientKey = asString(doc.get("client_key"));
      const periodMonth = asString(doc.get("period_month"));
      return Boolean(clientKey && periodMonth && latestByClient.get(clientKey) === periodMonth);
    })
    .map((doc) => ({
      clientKey: asString(doc.get("client_key")),
      periodMonth: asString(doc.get("period_month")),
      sortOrder: asNumber(doc.get("sort_order")),
      label: asString(doc.get("label")),
      conditions: doc.get("conditions") ?? [],
      result: doc.get("result") ?? {},
    }))
    .sort(
      (a, b) =>
        String(a.clientKey).localeCompare(String(b.clientKey)) || a.sortOrder - b.sortOrder,
    );

  const clients = ctx.clientsSnap.docs.map((doc) => {
    const raw = doc.data();
    return {
      key: asString(raw["key"]) ?? doc.id,
      name: asString(raw["name"]) ?? "",
      usesZone: raw["uses_zone"] === true,
      usesOrders: raw["uses_orders"] === true,
      usesHours: raw["uses_hours"] === true,
      fullDayHours: asNumber(raw["full_day_hours"], DEFAULT_DAY_HOURS),
      halfDayHours: asNumber(raw["half_day_hours"], 6),
      reducedHours: asNumber(raw["reduced_hours"], 3),
      requiredHoursPerDay: asNumber(raw["required_hours_per_day"], DEFAULT_DAY_HOURS),
      defaultOffDays: asNumber(raw["default_off_days"], DEFAULT_OFF_DAYS),
      defaultResult: asString(raw["default_result"]) ?? "ABS",
      goodThreshold: asNumber(raw["good_threshold"], settings.payroll_zone_efficiency_good),
      averageThreshold: asNumber(raw["average_threshold"], settings.payroll_zone_efficiency_low),
      isSystem: raw["is_system"] === true,
      sortOrder: asNumber(raw["sort_order"]),
    };
  });
  const clientByKey = new Map(clients.map((client) => [client.key, client]));

  // ---- covers and request rows -------------------------------------------
  type Cover = { acc: boolean; sick: boolean; off: boolean; accA: boolean; sickA: boolean; offA: boolean };
  const covers = new Map<string, Cover>();
  const requestRows: Array<Record<string, unknown>> = [];

  // `profiles.full_name ?? drivers.name ?? driver_code` — the same ladder the
  // rider app uses, so a request row never prints "—" for a real rider.
  const driverNameById = new Map<string, string>();
  const driverCodeById = new Map<string, string>();
  for (const doc of ctx.driverSnap.docs) {
    const raw = doc.data();
    const name = driverDisplayName(raw, ctx.profileNames.get(doc.id)) ?? null;
    const code = trimmedOrNull(raw["driver_code"]);
    if (name) driverNameById.set(doc.id, name);
    if (code) driverCodeById.set(doc.id, code);
  }

  for (const doc of ctx.requestsSnap.docs) {
    const raw = doc.data();
    const driverId = asString(raw["driver_id"]);
    if (!driverId) continue;

    const requestType = asString(raw["request_type"]);
    const payload = (raw["payload"] ?? {}) as Record<string, unknown>;
    const created = asDate(raw["created_at"]);
    const createdDay = created ? kuwaitDayString(created) : null;
    const windowStart = asString(raw["window_start_day"]) ?? createdDay;
    const windowEnd = asString(raw["window_end_day"]) ?? windowStart ?? createdDay;
    if (!windowStart || !windowEnd) continue;

    const from = windowStart < ctx.firstDay ? ctx.firstDay : windowStart;
    const to = windowEnd > ctx.lastDay ? ctx.lastDay : windowEnd;

    const cover = coverOf(requestType, payload);
    if (cover) {
      const approved = APPROVED_STATUSES.has(asString(raw["status"]) ?? "");
      for (const day of dayStringsBetween(from, to)) {
        const key = `${driverId}|${day}`;
        const entry = covers.get(key) ?? {
          acc: false,
          sick: false,
          off: false,
          accA: false,
          sickA: false,
          offA: false,
        };
        if (cover === "accident") {
          entry.acc = true;
          entry.accA = entry.accA || approved;
        } else if (cover === "sick") {
          entry.sick = true;
          entry.sickA = entry.sickA || approved;
        } else {
          entry.off = true;
          entry.offA = entry.offA || approved;
        }
        covers.set(key, entry);
      }
    }

    const tile = tileOf(requestType);
    if (!tile) continue;
    const status = asString(raw["status"]);
    const stepName = trimmedOrNull(raw["current_step_label"]);
    const roleKey = trimmedOrNull(raw["current_step_role_key"]);
    requestRows.push({
      id: doc.id,
      code: asString(raw["request_code"]) ?? doc.id,
      driverId,
      riderName:
        trimmedOrNull(raw["driver_name"]) ??
        ctx.profileNames.get(driverId) ??
        driverNameById.get(driverId) ??
        asString(raw["driver_code"]) ??
        driverCodeById.get(driverId) ??
        "—",
      riderCode:
        asString(raw["driver_code"]) ??
        asString(raw["employee_id"]) ??
        driverCodeById.get(driverId) ??
        "—",
      tile,
      day: windowStart,
      zone: asString(raw["zone_name"]) ?? "—",
      partner: asString(raw["partner_name"]) ?? "—",
      reviewingDept: stepName ?? (roleKey ? (ROLE_LABELS[roleKey] ?? roleKey) : "—"),
      liveStatus: status ?? "submitted",
      uiStatus: uiStatusOf(status),
    });
  }

  const dayGrid = dayStringsBetween(ctx.firstDay, ctx.lastDay).slice(0, days);

  const riders = ctx.driverSnap.docs
    .map((doc) => {
      const raw = doc.data();
      const driverId = doc.id;
      const employeeId = trimmedOrNull(raw["employee_id"]);
      const driverCode = trimmedOrNull(raw["driver_code"]);
      const projectKey = asString(raw["project_key"]);
      const client = projectKey ? clientByKey.get(projectKey) : undefined;
      const restaurantIds = restaurantCandidates(raw, ctx.driverRestaurantIds.get(driverId));
      const restaurantId =
        restaurantIds.find((id) => ctx.restaurantById.has(id)) ?? restaurantIds[0] ?? null;
      const restaurant = restaurantId ? ctx.restaurantById.get(restaurantId) : undefined;
      const driverZoneId = asString(raw["zone_id"]);
      // SOP: an Americana rider belongs to their restaurant's zone, falling back
      // to their own; every other client uses the driver zone.
      const zoneId =
        projectKey === "americana"
          ? (asString(restaurant?.["zone_id"]) ?? driverZoneId)
          : driverZoneId;
      const zoneName = zoneId ? (zoneNames.get(zoneId) ?? null) : null;

      const covered = dayGrid.map((day) => {
        const key = `${driverId}|${day}`;
        const cover = covers.get(key);
        const hours = ctx.workedByDriverDay.get(key) ?? 0;
        const adjustment = ctx.adjustmentByDriverDay.get(key);
        const reconHit = reconOrdersFor(ctx.recon, day, employeeId, driverCode);
        const counted = applyPayrollManualOrders(
          ctx.manualOrders.get(key) ?? null,
          reconHit,
          ctx.verifiedByDriverDay.get(key) ?? 0,
        );
        return {
          d: day,
          h: Math.round(hours * 100) / 100,
          o: counted.orders,
          do: counted.displayOrders,
          mo: counted.overridden ? counted.orders : null,
          // Whether an attendance log exists at all: a check-in with no check-out
          // is 0 h and is still a worked day, not an absent one.
          k: ctx.workedByDriverDay.has(key),
          c: cover ? (cover.acc ? "accident" : cover.sick ? "sick" : "off") : null,
          ca: cover ? Boolean(cover.acc ? cover.accA : cover.sick ? cover.sickA : cover.offA) : false,
          x: asString(adjustment?.["adjusted_status"]),
          xh: nullableNumber(adjustment?.["adjusted_hours"]),
        };
      });

      const off = ctx.offStructure.get(driverId);
      return {
        driverId,
        amId: employeeId ?? "—",
        mgId: driverCode ?? "—",
        name: driverDisplayName(raw, ctx.profileNames.get(driverId)) ?? "—",
        employeeId,
        restaurant:
          isKeetaProjectKey(projectKey)
            ? "Keeta"
            : asString(restaurant?.["name"]) ?? firstRestaurantName(raw) ?? "—",
        restaurantId,
        // The rider's merchant-facing id (what staff know the store by) — the
        // same `client_id` the Employees page shows for the rider. The doc id
        // above stays the slicer key; this is display only.
        restaurantClientId:
          asString(raw["client_id"]) ?? asString(restaurant?.["external_merchant_id"]),
        zone: zoneName ?? "—",
        zoneId,
        zoneName,
        partner:
          projectKey === "americana"
            ? "Americana"
            : isKeetaProjectKey(projectKey)
              ? "Keeta"
              : trimmedOrNull(raw["partner_name"]) ?? "—",
        projectKey,
        nationality:
          asString(raw["nationality"]) ?? asString(raw["nationality_code"]) ?? "—",
        nationalityCode:
          asString(raw["nationality_code"]) ?? asString(raw["nationality"]),
        status: asString(raw["status"]) === "active" ? "Active" : "Inactive",
        vehicleKey:
          asString(raw["vehicle_key"]) ??
          asString(raw["vehicle_type_key"]) ??
          asString(raw["vehicle_kind"]),
        sourceType: asString(raw["rider_category"]),
        sourceCompany: asString(raw["source_company"]),
        offStructureDays: off?.offDays ?? client?.defaultOffDays ?? DEFAULT_OFF_DAYS,
        offStructureSource: off
          ? off.source === "bulk_upload"
            ? "bulk_upload"
            : "manual"
          : "default",
        days: covered,
      };
    })
    .filter((row) => passesSlicers(row, raw_slicers(slicers)));

  const zoneOptions = new Map<string, string>();
  const restaurantOptions = new Map<string, string>();
  const nationalities = new Set<string>();
  const sourceCompanies = new Set<string>();
  for (const row of riders) {
    if (row.zoneId && row.zoneName) zoneOptions.set(row.zoneId, row.zoneName);
    // The label carries the project for a Keeta rider, so the restaurant filter
    // must exclude it by that label; the project-key check above keeps any
    // future non-store project out as well.
    if (row.restaurantId && !isKeetaProjectKey(row.projectKey) && row.restaurant !== "Keeta") {
      restaurantOptions.set(row.restaurantId, row.restaurant);
    }
    if (row.nationalityCode) nationalities.add(row.nationalityCode);
    if (row.sourceCompany) sourceCompanies.add(row.sourceCompany);
  }

  return {
    today: ctx.today,
    month: {
      key: month,
      year: parseMonthKey(month).year,
      month: parseMonthKey(month).month,
      days,
      label: monthLabel(parseMonthKey(month).year, parseMonthKey(month).month),
      fixedDays: days - DEFAULT_OFF_DAYS,
    },
    months: monthOptions(ctx.today.slice(0, 7)),
    zoneMonth: ctx.zoneMonth,
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
    clients,
    rules,
    zoneMetrics,
    canManage: canManagePayroll(staff),
    riders: riders.sort((a, b) => a.name.localeCompare(b.name)),
    requests: requestRows.sort((a, b) => {
      const rank = (status: unknown) =>
        status === "pending" ? 0 : status === "under_review" ? 1 : status === "approved" ? 2 : 3;
      return rank(a.uiStatus) - rank(b.uiStatus) || String(a.day).localeCompare(String(b.day));
    }),
    requestKpis: buildRequestKpis(requestRows),
  };
}

function raw_slicers(slicers: Slicers): Slicers {
  return slicers;
}

type RiderRow = {
  zoneId: string | null;
  projectKey: string | null;
  vehicleKey: string | null;
  nationalityCode: string | null;
  sourceType: string | null;
  sourceCompany: string | null;
  restaurantId: string | null;
};

/**
 * The slicer predicates, ported verbatim.
 *
 * The zone slicer accepts either the driver's own zone or the payroll zone,
 * because for an Americana rider those differ when the restaurant the rider
 * serves sits in another zone — and a filter that only checked one of them would
 * hide the rider from the very queue that exists to pay them.
 */
function passesSlicers(row: RiderRow, slicers: Slicers): boolean {
  if (!inList(slicers.projectKeys, row.projectKey)) return false;
  if (slicers.zoneIds?.length) {
    const matchesZone = slicers.zoneIds.includes(row.zoneId ?? "");
    if (!matchesZone) return false;
  }
  if (slicers.vehicleKeys?.length) {
    if (!row.vehicleKey || !slicers.vehicleKeys.includes(row.vehicleKey)) return false;
  }
  if (!inList(slicers.nationalities, row.nationalityCode)) return false;
  if (!inList(slicers.sourceTypes, row.sourceType)) return false;
  if (!inList(slicers.sourceCompanies, row.sourceCompany)) return false;
  if (!inList(slicers.restaurantIds, row.restaurantId)) return false;
  return true;
}

function buildRequestKpis(rows: Array<Record<string, unknown>>) {
  const count = (status: string) => rows.filter((row) => row.uiStatus === status).length;
  const total = rows.length;
  const approved = count("approved");
  return {
    total,
    pending: count("pending"),
    underReview: count("under_review"),
    approved,
    rejected: count("rejected"),
    approvalRate: total === 0 ? 0 : (approved / total) * 100,
  };
}

function canManagePayroll(staff: StaffContext): boolean {
  if (staff.isSuperAdmin || staff.isManager) return true;
  return (
    staff.permissionSlugs.has("payroll.edit") ||
    staff.permissionSlugs.has("payroll.manage") ||
    staff.permissionSlugs.has("payroll.create")
  );
}
