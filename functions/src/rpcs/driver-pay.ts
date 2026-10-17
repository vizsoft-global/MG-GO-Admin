/**
 * Driver Pay calculator + the compliance refresh ping.
 *
 * `driverGetPayCalculator` mirrors `src/features/payroll/driver-pay-plan.ts` — the
 * plan is validated here with the same rules the panel uses, so a stored plan the
 * panel would refuse cannot reach a rider's screen as a payout figure. The
 * calculator reads `deliveries` directly rather than the `rollups_*` collections,
 * which are only partially backfilled.
 *
 * `adminNotifyComplianceRefresh` is a silent data-only FCM. It deliberately writes
 * no inbox document: the panel and the rider app both treat the compliance upload
 * as an out-of-band data change, and an inbox row here would make an admin sync
 * look like a message a rider is expected to open.
 */
import { onCall } from "firebase-functions/v2/https";
import { getMessaging } from "firebase-admin/messaging";
import { getFirestore, Timestamp } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { kuwaitDayRange, kuwaitDayString } from "../core/kuwait";
import { kuwaitMonthEnd, kuwaitMonthStart } from "../core/money";
import { requireRider } from "../core/rider";
import { requireStaffAny } from "../core/staff";
import { pickIdList, type Dict } from "./_shared";
import { loadActivePushTokens, pickLatestActivePushToken } from "./driver-push-tokens";

/** One page of deliveries, per range field. Mirrors the home dashboard scan. */
const SCAN = 5_000;
/** The panel caps a compliance refresh at this many drivers. */
const MAX_REFRESH_DRIVERS = 500;

export type PayBand = { from: number; to: number | null; rate: number };

export type PayPlan = {
  base_kwd: number;
  low_base_kwd: number;
  threshold: number;
  floor_kwd: number;
  bands: PayBand[];
  penalty_bike: number;
  penalty_car: number;
  invalid_ladder: [number, number, number];
};

export type ComplianceTotals = {
  invalid_days: number;
  rejected_orders: number;
  cancelled_orders: number;
};

/** The SOP fallback. Returned whenever a stored plan is missing or invalid. */
export function defaultPayPlan(): PayPlan {
  return {
    base_kwd: 120,
    low_base_kwd: 90,
    threshold: 300,
    floor_kwd: 90,
    bands: [
      { from: 301, to: 400, rate: 0.26 },
      { from: 401, to: 500, rate: 0.35 },
      { from: 501, to: 600, rate: 0.4 },
      { from: 601, to: null, rate: 0.45 },
    ],
    penalty_bike: 2,
    penalty_car: 3,
    invalid_ladder: [7, 21, 120],
  };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asDay(value: unknown): string | null {
  const text = asString(value);
  return text ? text.slice(0, 10) : null;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function wholeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Open band is `null`. A numeric end, including 0, stays a number. */
function bandEnd(value: unknown, fallback: number | null): number | null {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

/** The same rule set as `validatePayPlan` in the panel, so they cannot disagree. */
export function validatePayPlan(plan: PayPlan): boolean {
  if (!Number.isFinite(plan.base_kwd) || plan.base_kwd < 0) return false;
  if (!Number.isFinite(plan.low_base_kwd) || plan.low_base_kwd < 0) return false;
  if (!Number.isFinite(plan.floor_kwd) || plan.floor_kwd < 0) return false;
  if (!Number.isFinite(plan.threshold) || plan.threshold < 0) return false;
  if (plan.bands.length === 0) return false;

  const bands = [...plan.bands].sort((a, b) => a.from - b.from);
  if (bands[0]?.from !== plan.threshold + 1) return false;
  for (let i = 0; i < bands.length; i += 1) {
    const band = bands[i];
    if (!band || !Number.isFinite(band.rate) || band.rate < 0) return false;
    if (!Number.isFinite(band.from)) return false;
    if (i === bands.length - 1) {
      if (band.to !== null) return false;
      continue;
    }
    if (band.to == null || !Number.isFinite(band.to) || band.to < band.from) return false;
    const next = bands[i + 1];
    if (!next) return false;
    if (next.from <= band.to) return false;
    if (next.from !== band.to + 1) return false;
  }
  if (plan.invalid_ladder.some((step) => !Number.isFinite(step) || step < 0)) return false;
  return true;
}

/** A stored plan that fails validation falls back to the SOP default. */
export function parsePayPlan(raw: unknown): PayPlan {
  const fallback = defaultPayPlan();
  if (!raw || typeof raw !== "object") return fallback;
  const row = raw as Record<string, unknown>;

  const bandsRaw = Array.isArray(row.bands) ? row.bands : fallback.bands;
  const bands: PayBand[] = bandsRaw.map((item, index) => {
    const band = (item ?? {}) as Record<string, unknown>;
    const seed = fallback.bands[index] ?? fallback.bands[fallback.bands.length - 1];
    return {
      from: num(band.from, seed?.from ?? fallback.threshold + 1),
      to: bandEnd(band.to, seed?.to ?? null),
      rate: num(band.rate, seed?.rate ?? 0),
    };
  });

  // `invalid_ladder` is what the panel writes. `invalidLadder` is the legacy
  // camelCase spelling both TypeScript parsers still accept, so a document that
  // carries only that key is read as the real ladder here too instead of as the
  // SOP default. Nothing writes it today; this is a read-side tolerance only.
  const ladderRaw = Array.isArray(row.invalid_ladder)
    ? row.invalid_ladder
    : Array.isArray(row.invalidLadder)
      ? row.invalidLadder
      : null;
  const ladder = ladderRaw ?? fallback.invalid_ladder;
  const plan: PayPlan = {
    base_kwd: num(row.base_kwd, fallback.base_kwd),
    low_base_kwd: num(row.low_base_kwd, fallback.low_base_kwd),
    threshold: num(row.threshold, fallback.threshold),
    floor_kwd: num(row.floor_kwd, fallback.floor_kwd),
    bands: bands.length > 0 ? bands : fallback.bands,
    penalty_bike: num(row.penalty_bike, fallback.penalty_bike),
    penalty_car: num(row.penalty_car, fallback.penalty_car),
    invalid_ladder: [
      num(ladder[0], fallback.invalid_ladder[0]),
      num(ladder[1], fallback.invalid_ladder[1]),
      num(ladder[2], fallback.invalid_ladder[2]),
    ],
  };
  return validatePayPlan(plan) ? plan : fallback;
}

/** `drivers.vehicle_id -> vehicles.vehicle_type_key`. Missing is a bike. */
async function resolveVehicle(driver: Dict): Promise<"bike" | "car"> {
  const vehicleId = asString(driver["vehicle_id"]);
  if (!vehicleId) return "bike";
  try {
    const snap = await getFirestore().collection(COLLECTIONS.vehicles).doc(vehicleId).get();
    if (!snap.exists) return "bike";
    const key = asString((snap.data() ?? {})["vehicle_type_key"]);
    return key && key.toLowerCase().includes("car") ? "car" : "bike";
  } catch {
    return "bike";
  }
}

/** The stored plan, or the SOP default. A missing `app_settings` doc is not an error. */
async function loadPayPlan(): Promise<PayPlan> {
  try {
    const snap = await getFirestore().collection(COLLECTIONS.appSettings).doc("1").get();
    return parsePayPlan((snap.data() ?? {})["driver_pay_plan"]);
  } catch {
    return defaultPayPlan();
  }
}

/** The day a delivery belongs to — `shift_date`, else the delivered/pickup instant. */
function deliveryDay(raw: Dict): string | null {
  const shift = asDay(raw["shift_date"]);
  if (shift) return shift;
  const at = asDate(raw["delivered_at"]) ?? asDate(raw["pickup_at"]);
  return at ? kuwaitDayString(at) : asDay(raw["delivered_day"]) ?? asDay(raw["created_day"]);
}

/** VERIFIED deliveries only, on the Kuwait day that falls inside `[from, to]`. */
async function countVerifiedOrders(driverId: string, from: string, to: string): Promise<number> {
  const col = getFirestore().collection(COLLECTIONS.deliveries);
  const [byShift, byDelivered] = await Promise.all([
    col
      .where("driver_id", "==", driverId)
      .where("shift_date", ">=", from)
      .where("shift_date", "<=", to)
      .limit(SCAN)
      .get(),
    col
      .where("driver_id", "==", driverId)
      .where("delivered_day", ">=", from)
      .where("delivered_day", "<=", to)
      .limit(SCAN)
      .get(),
  ]);
  const seen = new Set<string>();
  let count = 0;
  for (const snap of [byShift, byDelivered]) {
    for (const doc of snap.docs) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      const raw = (doc.data() ?? {}) as Dict;
      if (asString(raw["status"]) !== "verified") continue;
      const day = deliveryDay(raw);
      if (!day || day < from || day > to) continue;
      count += 1;
    }
  }
  return count;
}

/**
 * `rider_compliance_daily/{driverId}_{day}` summed over the whole month.
 *
 * A missing collection or zero rows is a zero, never a throw: compliance uploads
 * arrive after the month is over, so an early-month read legitimately has nothing.
 */
async function complianceMonthTotals(
  driverId: string,
  monthStart: string,
  monthEnd: string,
): Promise<ComplianceTotals> {
  const empty: ComplianceTotals = { invalid_days: 0, rejected_orders: 0, cancelled_orders: 0 };
  try {
    const days = kuwaitDayRange(monthStart, monthEnd);
    if (days.length === 0) return empty;
    const col = getFirestore().collection(COLLECTIONS.riderComplianceDaily);
    const snaps = await getFirestore().getAll(
      ...days.map((day) => col.doc(`${driverId}_${day}`)),
    );
    const totals: ComplianceTotals = { ...empty };
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const raw = (snap.data() ?? {}) as Dict;
      totals.invalid_days += wholeNumber(raw["invalid_days"]);
      totals.rejected_orders += wholeNumber(raw["rejected_orders"]);
      totals.cancelled_orders += wholeNumber(raw["cancelled_orders"]);
    }
    return totals;
  } catch {
    return empty;
  }
}

export const driverGetPayCalculator = onCall(async (request) => {
  const ctx = await requireRider(request);
  const today = kuwaitDayString(new Date());
  const monthStart = kuwaitMonthStart(today);
  const monthEnd = kuwaitMonthEnd(today);

  const [plan, orders, vehicle, compliance] = await Promise.all([
    loadPayPlan(),
    countVerifiedOrders(ctx.uid, monthStart, today),
    resolveVehicle(ctx.driver),
    complianceMonthTotals(ctx.uid, monthStart, monthEnd),
  ]);

  return {
    plan,
    prefill: {
      orders,
      vehicle,
      rejected: compliance.rejected_orders,
      cancelled: compliance.cancelled_orders,
      invalid_days: compliance.invalid_days,
      month: today.slice(0, 7),
    },
  };
});

/** The exact data payload the rider app's compliance refresh handler reads. */
export function complianceRefreshData(): Record<string, string> {
  return {
    payload_version: "2",
    action_type: "open_record",
    action_params: JSON.stringify({ record_type: "compliance" }),
    category: "system",
    priority: "low",
    screenshot_restricted: "0",
  };
}

export const adminNotifyComplianceRefresh = onCall(async (request) => {
  await requireStaffAny(request, ["compliance.manage", "drivers.manage"]);

  const data = (request.data ?? {}) as Dict;
  const driverIds = [...new Set(pickIdList(data, "driver_ids", "p_driver_ids") ?? [])].slice(
    0,
    MAX_REFRESH_DRIVERS,
  );
  if (driverIds.length === 0) return { ok: true, targeted: 0, sent: 0 };

  const messaging = getMessaging();
  const payload = complianceRefreshData();
  let sent = 0;

  await Promise.all(
    driverIds.map(async (driverId) => {
      try {
        const tokens = await loadActivePushTokens(driverId);
        const latest = pickLatestActivePushToken(tokens);
        if (!latest) return;
        // Data-only: no `notification` block, so the app never paints a tray entry.
        await messaging.send({
          token: latest.token,
          data: payload,
          android: { priority: "high" },
          apns: {
            headers: { "apns-push-type": "background", "apns-priority": "5" },
            payload: { aps: { "content-available": 1 } },
          },
        });
        sent += 1;
      } catch {
        // A push failure is not an admin-facing error; the panel already synced.
      }
    }),
  );

  return { ok: true, targeted: driverIds.length, sent };
});
