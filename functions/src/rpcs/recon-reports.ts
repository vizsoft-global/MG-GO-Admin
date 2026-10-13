/**
 * Order reconciliation and delivery-report RPCs.
 *
 * Ports of `admin_order_comparison_snapshot`, `admin_order_recon_compare`,
 * `reconcile_delivery_verification`, `delivery_matches_rules` and
 * `report_delivery_orders`. Deliveries are ranged on `delivered_at` between
 * Kuwait day bounds and bucketed by `kuwaitDayString(delivered_at)` in memory;
 * recon rows and driver shifts use their stored `YYYY-MM-DD` string fields.
 */
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "../core/fs";
import { COLLECTIONS, FIELDS } from "../core/collections";
import { kuwaitDayEnd, kuwaitDayStart, kuwaitDayString } from "../core/kuwait";
import { requireStaff } from "../core/staff";
import { haversineMeters, pointWithinZoneProximity, type ZoneFeature } from "../core/geo";
import { deliveryMatchesRules as matchesDeliveryRules, type DeliveryRule, type RuleScope } from "../core/incentive";
import {
  IN_FILTER_LIMIT,
  chunk,
  loadDocMap,
  numberOrNull,
  pick,
  pickDay,
  pickId,
  pickText,
  requireUid,
  type Dict,
} from "./_shared";
import { driverRestaurantIds } from "./deliveries-shared";

const DAY_MS = 24 * 60 * 60 * 1000;
const RECON_MAX_SPAN_DAYS = 93;
const REPORT_MAX_SPAN_DAYS = 366;
const RECON_ROW_SCAN_CAP = 50_000;
const RECON_DELIVERY_SCAN_CAP = 100_000;
const REPORT_DELIVERY_SCAN_CAP = 200_000;
const DRIVER_SCAN_CAP = 10_000;
const RECONCILE_WRITE_CAP = 450;
const SHIFT_QUERY_CONCURRENCY = 20;
const VERIFICATION_BALANCES = "verification_balances";
const APP_SETTINGS_DOC_ID = "1";
const LOGGED_STATUSES = new Set(["pending", "in_transit", "verified"]);

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function trimmedOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function millisOf(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (value && typeof value === "object" && "toDate" in (value as object)) {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  return null;
}

function dayOf(value: unknown): string | null {
  if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    return match ? match[1] : null;
  }
  const ms = millisOf(value);
  return ms === null ? null : kuwaitDayString(ms);
}

function isRealDay(day: string): boolean {
  return kuwaitDayString(kuwaitDayStart(day)) === day;
}

function addDays(day: string, n: number): string {
  return kuwaitDayString(kuwaitDayStart(day).getTime() + n * DAY_MS);
}

function spanDays(from: string, to: string): number {
  return Math.round((kuwaitDayStart(to).getTime() - kuwaitDayStart(from).getTime()) / DAY_MS) + 1;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `HH:MM[:SS]` to seconds of day; `null` when absent. */
function parseClock(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new HttpsError("invalid-argument", "invalid_time");
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(value.trim());
  if (!match) throw new HttpsError("invalid-argument", "invalid_time");
  const h = Number(match[1]);
  const m = Number(match[2]);
  const s = match[3] ? Number(match[3]) : 0;
  if (h > 23 || m > 59 || s > 59) throw new HttpsError("invalid-argument", "invalid_time");
  return h * 3600 + m * 60 + s;
}

function parseRange(data: Dict, invalidCode: string): { from: string; to: string } {
  const from = pickDay(data, "from", "p_from");
  const to = pickDay(data, "to", "p_to");
  if (!from || !to || !isRealDay(from) || !isRealDay(to) || to < from) {
    throw new HttpsError("invalid-argument", invalidCode);
  }
  return { from, to };
}

/**
 * Every delivery whose `delivered_at` falls on a Kuwait day in `[fromDay, toDay]`.
 * Ranges on the timestamp because `delivered_day` is never populated.
 */
async function loadDeliveriesByDay(
  fromDay: string,
  toDay: string,
  cap: number,
): Promise<Array<{ id: string; data: Dict }>> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.deliveries)
    .where(FIELDS.deliveries.deliveredAt, ">=", kuwaitDayStart(fromDay))
    .where(FIELDS.deliveries.deliveredAt, "<", kuwaitDayEnd(toDay))
    .select(
      FIELDS.deliveries.driverId,
      FIELDS.deliveries.restaurantId,
      FIELDS.deliveries.status,
      FIELDS.deliveries.deliveredAt,
    )
    .limit(cap + 1)
    .get();
  if (snap.size > cap) throw new HttpsError("out-of-range", "range_too_large");
  return snap.docs.map((doc) => ({ id: doc.id, data: (doc.data() ?? {}) as Dict }));
}

/** `MIN(name)` over a driver's restaurants, optionally only published ones. */
function firstRestaurantName(
  driver: Dict | undefined,
  restaurantById: Map<string, Dict>,
  publishedOnly: boolean,
): string | null {
  let best: string | null = null;
  for (const id of driverRestaurantIds(driver)) {
    const restaurant = restaurantById.get(id);
    if (!restaurant) continue;
    if (publishedOnly && restaurant.status !== "published") continue;
    const name = str(restaurant.name);
    if (name === null) continue;
    if (best === null || compareText(name, best) < 0) best = name;
  }
  return best;
}

async function loadRestaurantsForDrivers(drivers: Iterable<Dict>): Promise<Map<string, Dict>> {
  const ids = new Set<string>();
  for (const driver of drivers) for (const id of driverRestaurantIds(driver)) ids.add(id);
  return loadDocMap(COLLECTIONS.restaurants, [...ids]);
}

// ---------------------------------------------------------------------------
// admin_order_comparison_snapshot
// ---------------------------------------------------------------------------

export const adminOrderComparisonSnapshot = onCall(async (request) => {
  await requireStaff(request);
  const data = (request.data ?? {}) as Dict;
  const { from, to } = parseRange(data, "invalid_range");
  if (spanDays(from, to) > RECON_MAX_SPAN_DAYS) {
    throw new HttpsError("out-of-range", "range_too_large");
  }

  const db = getFirestore();

  const rowsSnap = await db
    .collection(COLLECTIONS.orderReconRows)
    .where("work_date", ">=", from)
    .where("work_date", "<=", to)
    .limit(RECON_ROW_SCAN_CAP + 1)
    .get();
  if (rowsSnap.size > RECON_ROW_SCAN_CAP) throw new HttpsError("out-of-range", "range_too_large");

  const reconRows = rowsSnap.docs
    .map((doc) => ({ id: doc.id, raw: (doc.data() ?? {}) as Dict }))
    .sort((a, b) => compareText(a.id, b.id));
  const runIds = [...new Set(reconRows.map((row) => str(row.raw.run_id)).filter((id): id is string => id !== null))];
  const runs = await loadDocMap(COLLECTIONS.orderReconRuns, runIds);

  type AmPick = { runId: string; createdAt: number; mgIdRaw: string; riderName: string | null };
  const amLatest = new Map<string, AmPick>();
  for (const { raw } of reconRows) {
    const runId = str(raw.run_id);
    const run = runId ? runs.get(runId) : undefined;
    if (!runId || !run || run.status !== "applied") continue;
    const mgIdRaw = typeof raw.employee_id === "string" ? raw.employee_id : null;
    const mgId = trimmedOrNull(mgIdRaw)?.toLowerCase();
    const workDate = dayOf(raw.work_date);
    if (!mgIdRaw || !mgId || !workDate || workDate < from || workDate > to) continue;
    const key = `${mgId}|${workDate}`;
    const createdAt = millisOf(run.created_at) ?? 0;
    const current = amLatest.get(key);
    if (!current || createdAt > current.createdAt) {
      amLatest.set(key, {
        runId,
        createdAt,
        mgIdRaw,
        riderName: typeof raw.employee_name === "string" ? raw.employee_name : null,
      });
    }
  }

  type AmRow = { mgId: string; mgIdRaw: string; workDate: string; orders: number; riderName: string | null };
  const amByKey = new Map<string, AmRow>();
  for (const { raw } of reconRows) {
    const runId = str(raw.run_id);
    const mgId = trimmedOrNull(raw.employee_id)?.toLowerCase();
    const workDate = dayOf(raw.work_date);
    if (!runId || !mgId || !workDate) continue;
    const key = `${mgId}|${workDate}`;
    const latest = amLatest.get(key);
    if (!latest || latest.runId !== runId) continue;
    const row = amByKey.get(key) ?? {
      mgId,
      mgIdRaw: latest.mgIdRaw,
      workDate,
      orders: 0,
      riderName: latest.riderName,
    };
    row.orders += Math.trunc(numberOrNull(raw.excel_orders) ?? 0);
    amByKey.set(key, row);
  }

  const deliveries = await loadDeliveriesByDay(from, to, RECON_DELIVERY_SCAN_CAP);
  const deliveryDriverIds = new Set<string>();
  for (const { data: d } of deliveries) {
    const driverId = str(d.driver_id);
    if (driverId) deliveryDriverIds.add(driverId);
  }

  const [driverSnap, deliveryDrivers] = await Promise.all([
    db
      .collection(COLLECTIONS.drivers)
      .where(FIELDS.drivers.archivedAt, "==", null)
      .limit(DRIVER_SCAN_CAP + 1)
      .get(),
    loadDocMap(COLLECTIONS.drivers, [...deliveryDriverIds]),
  ]);
  if (driverSnap.size > DRIVER_SCAN_CAP) throw new HttpsError("out-of-range", "scan_cap_exceeded");

  type MggoRow = { mgId: string; mgIdRaw: string; workDate: string; orders: number };
  const mggoByKey = new Map<string, MggoRow>();
  for (const { data: d } of deliveries) {
    if (!LOGGED_STATUSES.has(String(d.status))) continue;
    const deliveredAt = millisOf(d.delivered_at);
    if (deliveredAt === null) continue;
    const workDate = kuwaitDayString(deliveredAt);
    if (workDate < from || workDate > to) continue;
    const driverId = str(d.driver_id);
    const driver = driverId ? deliveryDrivers.get(driverId) : undefined;
    const mgIdRaw = driver && typeof driver.employee_id === "string" ? driver.employee_id : null;
    const mgId = trimmedOrNull(mgIdRaw)?.toLowerCase();
    if (!mgIdRaw || !mgId) continue;
    const key = `${mgId}|${workDate}`;
    const row = mggoByKey.get(key) ?? { mgId, mgIdRaw, workDate, orders: 0 };
    if (compareText(mgIdRaw, row.mgIdRaw) > 0) row.mgIdRaw = mgIdRaw;
    row.orders += 1;
    mggoByKey.set(key, row);
  }

  const keys = new Set<string>();
  for (const row of amByKey.values()) keys.add(row.mgId);
  for (const row of mggoByKey.values()) keys.add(row.mgId);

  const riderDrivers = driverSnap.docs
    .map((doc) => ({ id: doc.id, raw: (doc.data() ?? {}) as Dict }))
    .filter(({ raw }) => {
      const mgId = trimmedOrNull(raw.employee_id)?.toLowerCase();
      return mgId !== undefined && keys.has(mgId);
    });
  const [profiles, restaurants] = await Promise.all([
    loadDocMap(COLLECTIONS.profiles, riderDrivers.map((driver) => driver.id)),
    loadRestaurantsForDrivers(riderDrivers.map((driver) => driver.raw)),
  ]);

  const riders = riderDrivers
    .map(({ id, raw }) => ({
      sortKey: (trimmedOrNull(raw.employee_id) ?? "").toLowerCase(),
      row: {
        mg_id: raw.employee_id as string,
        driver_id: id,
        rider_name: str(profiles.get(id)?.full_name) ?? "",
        restaurant_name: firstRestaurantName(raw, restaurants, false) ?? "—",
      },
    }))
    .sort((a, b) => compareText(a.sortKey, b.sortKey))
    .map((entry) => entry.row);

  const byMgThenDay = (a: { mgId: string; workDate: string }, b: { mgId: string; workDate: string }) =>
    compareText(a.mgId, b.mgId) || compareText(a.workDate, b.workDate);

  return {
    am: [...amByKey.values()].sort(byMgThenDay).map((row) => ({
      mg_id: row.mgIdRaw,
      work_date: row.workDate,
      orders: row.orders,
      rider_name: row.riderName,
    })),
    mggo: [...mggoByKey.values()].sort(byMgThenDay).map((row) => ({
      mg_id: row.mgIdRaw,
      work_date: row.workDate,
      orders: row.orders,
    })),
    riders,
  };
});

// ---------------------------------------------------------------------------
// admin_order_recon_compare
// ---------------------------------------------------------------------------

export const adminOrderReconCompare = onCall(async (request) => {
  await requireStaff(request);
  const data = (request.data ?? {}) as Dict;
  const { from, to } = parseRange(data, "invalid_range");
  if (spanDays(from, to) > RECON_MAX_SPAN_DAYS) {
    throw new HttpsError("out-of-range", "range_too_large");
  }

  const excelRaw = pick(data, "excel", "p_excel");
  const excelList = Array.isArray(excelRaw) ? excelRaw : [];
  const excel = excelList.map((item) => {
    const row = (typeof item === "object" && item !== null ? item : {}) as Dict;
    const orders = numberOrNull(row.excel_orders);
    return {
      driver_id: trimmedOrNull(row.driver_id),
      restaurant_id: trimmedOrNull(row.restaurant_id),
      work_date: dayOf(row.work_date),
      excel_orders: orders === null ? 0 : Math.trunc(orders),
    };
  });

  const deliveries = await loadDeliveriesByDay(from, to, RECON_DELIVERY_SCAN_CAP);
  type AppRow = { driver_id: string | null; restaurant_id: string | null; work_date: string; app_orders: number };
  const app = new Map<string, AppRow>();
  for (const { data: d } of deliveries) {
    if (!LOGGED_STATUSES.has(String(d.status))) continue;
    const deliveredAt = millisOf(d.delivered_at);
    if (deliveredAt === null) continue;
    const workDate = kuwaitDayString(deliveredAt);
    if (workDate < from || workDate > to) continue;
    const driverId = str(d.driver_id);
    const restaurantId = str(d.restaurant_id);
    const key = `${driverId ?? ""}|${restaurantId ?? ""}|${workDate}`;
    const row = app.get(key) ?? { driver_id: driverId, restaurant_id: restaurantId, work_date: workDate, app_orders: 0 };
    row.app_orders += 1;
    app.set(key, row);
  }

  const matched = new Set<string>();
  const out: Dict[] = [];
  for (const row of excel) {
    const key =
      row.driver_id !== null && row.work_date !== null
        ? `${row.driver_id}|${row.restaurant_id ?? ""}|${row.work_date}`
        : null;
    const hit = key ? app.get(key) : undefined;
    if (key && hit) matched.add(key);
    const appOrders = hit?.app_orders ?? 0;
    out.push({
      driver_id: row.driver_id,
      restaurant_id: row.restaurant_id,
      work_date: row.work_date,
      excel_orders: row.excel_orders,
      app_orders: appOrders,
      difference: appOrders - row.excel_orders,
    });
  }

  const unmatched = [...app.entries()]
    .filter(([key]) => !matched.has(key))
    .map(([, row]) => row)
    .sort(
      (a, b) =>
        compareText(a.driver_id ?? "", b.driver_id ?? "") ||
        compareText(a.restaurant_id ?? "", b.restaurant_id ?? "") ||
        compareText(a.work_date, b.work_date),
    );
  for (const row of unmatched) {
    out.push({
      driver_id: row.driver_id,
      restaurant_id: row.restaurant_id,
      work_date: row.work_date,
      excel_orders: 0,
      app_orders: row.app_orders,
      difference: row.app_orders,
    });
  }

  return out;
});

// ---------------------------------------------------------------------------
// reconcile_delivery_verification
// ---------------------------------------------------------------------------

type VerificationStatus = "matched" | "surplus" | "deficit";

export const reconcileDeliveryVerification = onCall(async (request) => {
  await requireStaff(request);
  const data = (request.data ?? {}) as Dict;
  const verificationId = pickId(data, "verificationId", "p_verification_id", "id");
  if (!verificationId) throw new HttpsError("invalid-argument", "verification_not_found");

  const db = getFirestore();
  const verificationRef = db.collection(COLLECTIONS.deliveryVerifications).doc(verificationId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(verificationRef);
    if (!snap.exists) throw new HttpsError("not-found", "verification_not_found");
    const row = (snap.data() ?? {}) as Dict;

    if (row.status === "reverted") return { ok: true, skipped: "reverted" };

    const driverId = str(row.driver_id);
    const restaurantId = str(row.restaurant_id);
    const partnerId = str(row.partner_id);
    const serviceDate = dayOf(row.service_date);
    const reported = Math.max(0, Math.trunc(numberOrNull(row.reported_count) ?? 0));

    let candidates: Array<{ id: string; at: number }> = [];
    if (driverId && serviceDate) {
      const deliveriesSnap = await tx.get(
        db
          .collection(COLLECTIONS.deliveries)
          .where(FIELDS.deliveries.driverId, "==", driverId)
          .where(FIELDS.deliveries.deliveredAt, ">=", kuwaitDayStart(serviceDate))
          .where(FIELDS.deliveries.deliveredAt, "<", kuwaitDayEnd(serviceDate))
          .limit(RECONCILE_WRITE_CAP + 1),
      );
      if (deliveriesSnap.size > RECONCILE_WRITE_CAP) {
        throw new HttpsError("out-of-range", "scan_cap_exceeded");
      }
      candidates = deliveriesSnap.docs
        .map((doc) => ({ id: doc.id, raw: (doc.data() ?? {}) as Dict }))
        .filter(({ raw }) => {
          const at = millisOf(raw.delivered_at);
          if (at === null || kuwaitDayString(at) !== serviceDate) return false;
          if (raw.status === "rejected") return false;
          const deliveryRestaurant = str(raw.restaurant_id);
          return (
            (deliveryRestaurant !== null && deliveryRestaurant === restaurantId) ||
            (deliveryRestaurant === null && partnerId !== null && str(raw.partner_id) === partnerId)
          );
        })
        .map(({ id, raw }) => ({ id, at: millisOf(raw.delivered_at) ?? 0 }))
        .sort((a, b) => a.at - b.at || compareText(a.id, b.id));
    }

    const actual = candidates.length;
    const take = Math.min(reported, actual);
    const excess = Math.max(actual - reported, 0);
    const shortfall = Math.max(reported - actual, 0);

    let status: VerificationStatus;
    if (actual === 0 && reported === 0) status = "matched";
    else if (excess > 0) status = "surplus";
    else if (shortfall > 0) status = "deficit";
    else status = "matched";

    const now = FieldValue.serverTimestamp();
    candidates.forEach((candidate, index) => {
      tx.update(db.collection(COLLECTIONS.deliveries).doc(candidate.id), {
        status: index < take ? "verified" : "under_review",
        updated_at: now,
      });
    });

    if (shortfall > 0 && driverId && restaurantId) {
      tx.set(
        db.collection(VERIFICATION_BALANCES).doc(`${driverId}_${restaurantId}`),
        {
          driver_id: driverId,
          restaurant_id: restaurantId,
          balance_count: FieldValue.increment(shortfall),
          last_verification_id: verificationId,
          updated_at: now,
        },
        { merge: true },
      );
    }

    tx.update(verificationRef, {
      matched_count: take,
      under_review_count: excess,
      shortfall_count: shortfall,
      status,
      reconciled_at: now,
      updated_at: now,
    });

    return {
      ok: true,
      status,
      matched_count: take,
      under_review_count: excess,
      shortfall_count: shortfall,
    };
  });
});

// ---------------------------------------------------------------------------
// delivery_matches_rules
// ---------------------------------------------------------------------------

async function loadDeliveryProximityMeters(): Promise<number> {
  const snap = await getFirestore().collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID).get();
  if (!snap.exists) return 0;
  const value = numberOrNull((snap.data() ?? {}).driver_app_delivery_proximity_meters);
  return value ?? 500;
}

/** `_driver_restaurant_delivery_allowed` for one restaurant. */
function deliveryAllowedAt(args: {
  lat: number;
  lng: number;
  restaurant: Dict;
  geofences: Dict[];
  proximityMeters: number;
}): boolean {
  const { lat, lng, restaurant, geofences, proximityMeters } = args;
  const contains = (fence: Dict) =>
    pointWithinZoneProximity(
      lat,
      lng,
      fence.geometry as ZoneFeature,
      fence.zone_type === "circle" ? "circle" : "polygon",
      0,
    );
  const inclusions = geofences.filter((fence) => fence.kind === "inclusion");
  const inExclusion = geofences.some((fence) => fence.kind === "exclusion" && contains(fence));
  if (inExclusion) return false;
  if (inclusions.length > 0) return inclusions.some(contains);

  const pinLat = numberOrNull(restaurant.latitude);
  const pinLng = numberOrNull(restaurant.longitude);
  if (pinLat === null || pinLng === null) return false;
  return haversineMeters(lat, lng, pinLat, pinLng) <= Math.max(proximityMeters, 0);
}

/** `driver_resolve_pickup_restaurant`. */
async function driverResolvePickupRestaurant(
  driverId: string | null,
  lat: number | null,
  lng: number | null,
): Promise<string | null> {
  if (!driverId) return null;
  const db = getFirestore();
  const driverSnap = await db.collection(COLLECTIONS.drivers).doc(driverId).get();
  if (!driverSnap.exists) return null;
  const driver = (driverSnap.data() ?? {}) as Dict;
  const partnerId = str(driver.partner_id);

  const restaurantMap = await loadDocMap(COLLECTIONS.restaurants, driverRestaurantIds(driver));
  const candidates = [...restaurantMap.entries()]
    .filter(
      ([, r]) =>
        r.status === "published" &&
        r.is_active === true &&
        (partnerId === null || str(r.partner_id) === partnerId),
    )
    .map(([id, r]) => ({ id, restaurant: r }));

  if (candidates.length === 1) return candidates[0].id;
  if (candidates.length === 0 || lat === null || lng === null) return null;

  const [proximityMeters, geofencesByRestaurant] = await Promise.all([
    loadDeliveryProximityMeters(),
    (async () => {
      const out = new Map<string, Dict[]>();
      for (const ids of chunk(candidates.map((c) => c.id), IN_FILTER_LIMIT)) {
        const snap = await db.collection(COLLECTIONS.restaurantGeofences).where("restaurant_id", "in", ids).get();
        for (const doc of snap.docs) {
          const fence = (doc.data() ?? {}) as Dict;
          const restaurantId = str(fence.restaurant_id);
          if (!restaurantId) continue;
          out.set(restaurantId, [...(out.get(restaurantId) ?? []), fence]);
        }
      }
      return out;
    })(),
  ]);

  const distanceTo = (restaurant: Dict): number | null => {
    const pinLat = numberOrNull(restaurant.latitude);
    const pinLng = numberOrNull(restaurant.longitude);
    return pinLat === null || pinLng === null ? null : haversineMeters(lat, lng, pinLat, pinLng);
  };
  const byDistance = candidates
    .map((c) => ({ ...c, distance: distanceTo(c.restaurant) }))
    .sort((a, b) => {
      if (a.distance === null && b.distance === null) return 0;
      if (a.distance === null) return 1;
      if (b.distance === null) return -1;
      return a.distance - b.distance;
    });

  const allowed = byDistance.find((c) =>
    deliveryAllowedAt({
      lat,
      lng,
      restaurant: c.restaurant,
      geofences: geofencesByRestaurant.get(c.id) ?? [],
      proximityMeters,
    }),
  );
  if (allowed) return allowed.id;

  const nearest = byDistance.find((c) => c.distance !== null);
  return nearest ? nearest.id : null;
}

export const deliveryMatchesRules = onCall(async (request) => {
  requireUid(request);
  const data = (request.data ?? {}) as Dict;
  const deliveryId = pickId(data, "deliveryId", "p_delivery_id", "id");
  if (!deliveryId) return false;
  const onDate = pickDay(data, "onDate", "p_on_date");

  const db = getFirestore();
  const deliverySnap = await db.collection(COLLECTIONS.deliveries).doc(deliveryId).get();
  if (!deliverySnap.exists) return false;
  const delivery = (deliverySnap.data() ?? {}) as Dict;
  if (delivery.status !== "verified") return false;

  const deliveredAt = millisOf(delivery.delivered_at);
  const checkDate = onDate ?? (deliveredAt === null ? null : kuwaitDayString(deliveredAt));
  if (checkDate === null) return true;

  const rulesSnap = await db.collection(COLLECTIONS.deliveryRules).where("status", "==", "active").get();
  const rules: DeliveryRule[] = rulesSnap.docs.map((doc) => {
    const raw = (doc.data() ?? {}) as Dict;
    return {
      id: doc.id,
      status: str(raw.status) ?? "draft",
      scope_type: (str(raw.scope_type) ?? "restaurant") as DeliveryRule["scope_type"],
      priority: numberOrNull(raw.priority) ?? 0,
      created_at: "",
      start_date: dayOf(raw.start_date) ?? "1970-01-01",
      end_date: dayOf(raw.end_date) ?? "9999-12-31",
      dpd_target: numberOrNull(raw.dpd_target),
      zone_id: str(raw.zone_id),
      partner_id: str(raw.partner_id),
      restaurant_id: str(raw.restaurant_id),
    };
  });
  const active = rules.filter((rule) => checkDate >= rule.start_date && checkDate <= rule.end_date);
  if (active.length === 0) return true;

  const scopesByRule = new Map<string, RuleScope[]>();
  for (const ids of chunk(active.map((rule) => rule.id), IN_FILTER_LIMIT)) {
    const snap = await db.collection(COLLECTIONS.deliveryRuleScopes).where("delivery_rule_id", "in", ids).get();
    for (const doc of snap.docs) {
      const raw = (doc.data() ?? {}) as Dict;
      const ruleId = str(raw.delivery_rule_id);
      if (!ruleId) continue;
      scopesByRule.set(ruleId, [
        ...(scopesByRule.get(ruleId) ?? []),
        { zone_id: str(raw.zone_id), partner_id: str(raw.partner_id), restaurant_id: str(raw.restaurant_id) },
      ]);
    }
  }

  const scopeRestaurantId =
    str(delivery.restaurant_id) ??
    (await driverResolvePickupRestaurant(
      str(delivery.driver_id),
      numberOrNull(delivery.pickup_lat),
      numberOrNull(delivery.pickup_lng),
    ));

  return matchesDeliveryRules({
    delivery: {
      status: "verified",
      zone_id: str(delivery.zone_id),
      partner_id: str(delivery.partner_id),
      scope_restaurant_id: scopeRestaurantId,
    },
    checkDate,
    deliveryRules: active,
    deliveryScopesByRule: scopesByRule,
  });
});

// ---------------------------------------------------------------------------
// report_delivery_orders
// ---------------------------------------------------------------------------

type ShiftWindow = { shiftDate: string; start: number; end: number };

function shiftInstant(shiftDate: string, clock: unknown, dayOffset: unknown): number | null {
  const seconds = typeof clock === "string" ? safeClock(clock) : null;
  if (seconds === null) return null;
  const offset = Math.trunc(numberOrNull(dayOffset) ?? 0);
  return kuwaitDayStart(addDays(shiftDate, offset)).getTime() + seconds * 1000;
}

function safeClock(value: string): number | null {
  try {
    return parseClock(value);
  } catch {
    return null;
  }
}

function shiftWindowsOf(raw: Dict): ShiftWindow[] {
  const shiftDate = dayOf(raw.shift_date);
  if (!shiftDate) return [];
  const out: ShiftWindow[] = [];
  const s1Start = shiftInstant(shiftDate, raw.session1_start, 0);
  const s1End = shiftInstant(shiftDate, raw.session1_end, raw.session1_end_day_offset);
  if (s1Start !== null && s1End !== null) out.push({ shiftDate, start: s1Start, end: s1End });
  if (raw.shift_type === "split" && raw.session2_start && raw.session2_end) {
    const s2Start = shiftInstant(shiftDate, raw.session2_start, raw.session2_start_day_offset);
    const s2End = shiftInstant(shiftDate, raw.session2_end, raw.session2_end_day_offset);
    if (s2Start !== null && s2End !== null) out.push({ shiftDate, start: s2Start, end: s2End });
  }
  return out;
}

async function loadShiftWindows(
  driverIds: readonly string[],
  fromDay: string,
  toDay: string,
): Promise<Map<string, ShiftWindow[]>> {
  const db = getFirestore();
  const out = new Map<string, ShiftWindow[]>();
  for (const group of chunk(driverIds, SHIFT_QUERY_CONCURRENCY)) {
    const snaps = await Promise.all(
      group.map((driverId) =>
        db
          .collection(COLLECTIONS.driverDailyShifts)
          .where("driver_id", "==", driverId)
          .where("shift_date", ">=", fromDay)
          .where("shift_date", "<=", toDay)
          .get(),
      ),
    );
    group.forEach((driverId, index) => {
      const windows = snaps[index].docs.flatMap((doc) => shiftWindowsOf((doc.data() ?? {}) as Dict));
      if (windows.length) out.set(driverId, windows);
    });
  }
  return out;
}

/** Shift-start-day attribution: in-window, then the latest earlier start, then nearest start. */
function attributeToShift(at: number, windows: readonly ShiftWindow[] | undefined): string {
  if (windows && windows.length) {
    let inWindow: ShiftWindow | null = null;
    let prev: ShiftWindow | null = null;
    let nearest: ShiftWindow | null = null;
    for (const w of windows) {
      if (at >= w.start && at < w.end && (!inWindow || w.start < inWindow.start)) inWindow = w;
      if (w.start <= at && (!prev || w.start > prev.start)) prev = w;
      if (!nearest || Math.abs(at - w.start) < Math.abs(at - nearest.start)) nearest = w;
    }
    const pickWindow = inWindow ?? prev ?? nearest;
    if (pickWindow) return pickWindow.shiftDate;
  }
  return kuwaitDayString(at);
}

export const reportDeliveryOrders = onCall(async (request) => {
  await requireStaff(request);
  const data = (request.data ?? {}) as Dict;

  const from = pickDay(data, "from", "p_from");
  const to = pickDay(data, "to", "p_to");
  if (!from || !to || !isRealDay(from) || !isRealDay(to) || from > to) {
    throw new HttpsError("invalid-argument", "invalid_date_range");
  }
  const fromClock = parseClock(pickText(data, "fromTime", "p_from_time")) ?? 0;
  const toClock = parseClock(pickText(data, "toTime", "p_to_time")) ?? 23 * 3600 + 59 * 60;
  const operational = fromClock !== 0;
  const exclusiveEnd = operational && fromClock === toClock;

  if (from === to && fromClock > toClock) {
    throw new HttpsError("invalid-argument", "invalid_date_range");
  }
  if (spanDays(from, to) > REPORT_MAX_SPAN_DAYS) {
    throw new HttpsError("out-of-range", "range_too_large");
  }

  const fromTs = kuwaitDayStart(from).getTime() + fromClock * 1000;
  const toTs = exclusiveEnd
    ? kuwaitDayStart(to).getTime() + toClock * 1000
    : kuwaitDayStart(to).getTime() + toClock * 1000 + 60_000 - 1;
  if (fromTs > toTs || (exclusiveEnd && fromTs >= toTs)) {
    throw new HttpsError("invalid-argument", "invalid_date_range");
  }

  const deliveries = await loadDeliveriesByDay(
    kuwaitDayString(fromTs),
    kuwaitDayString(toTs),
    REPORT_DELIVERY_SCAN_CAP,
  );
  const candidates: Array<{ driverId: string; at: number }> = [];
  for (const { data: d } of deliveries) {
    if (d.status === "rejected" || d.status === "cancelled") continue;
    const at = millisOf(d.delivered_at);
    const driverId = str(d.driver_id);
    if (at === null || !driverId || at < fromTs) continue;
    if (exclusiveEnd ? at >= toTs : at > toTs) continue;
    candidates.push({ driverId, at });
  }

  const counts = new Map<string, { driverId: string; shiftDate: string; count: number }>();
  const bump = (driverId: string, shiftDate: string) => {
    const key = `${driverId}|${shiftDate}`;
    const row = counts.get(key) ?? { driverId, shiftDate, count: 0 };
    row.count += 1;
    counts.set(key, row);
  };

  const driverIds = [...new Set(candidates.map((c) => c.driverId))];

  if (operational) {
    const colFrom = from;
    const colTo = toClock <= fromClock && to > from ? addDays(to, -1) : to;
    for (const c of candidates) {
      let day = kuwaitDayString(c.at - fromClock * 1000);
      if (day < colFrom) day = colFrom;
      if (day > colTo) day = colTo;
      bump(c.driverId, day);
    }
  } else {
    const windows = await loadShiftWindows(driverIds, addDays(from, -1), to);
    for (const c of candidates) {
      const day = attributeToShift(c.at, windows.get(c.driverId));
      if (day >= from && day <= to) bump(c.driverId, day);
    }
  }

  const reportDriverIds = [...new Set([...counts.values()].map((row) => row.driverId))];
  const [drivers, profiles] = await Promise.all([
    loadDocMap(COLLECTIONS.drivers, reportDriverIds),
    loadDocMap(COLLECTIONS.profiles, reportDriverIds),
  ]);
  const restaurants = await loadRestaurantsForDrivers(drivers.values());

  const rows = [...counts.values()]
    .filter((row) => drivers.has(row.driverId))
    .map((row) => {
      const driver = drivers.get(row.driverId);
      const fullName = str(profiles.get(row.driverId)?.full_name);
      return {
        sortName: fullName,
        row: {
          driver_id: row.driverId,
          driver_code: str(driver?.driver_code),
          employee_id: str(driver?.employee_id),
          full_name: fullName ?? "—",
          store_name: firstRestaurantName(driver, restaurants, true) ?? "—",
          shift_date: row.shiftDate,
          delivery_count: row.count,
        },
      };
    })
    .sort((a, b) => {
      if (a.sortName !== b.sortName) {
        if (a.sortName === null) return 1;
        if (b.sortName === null) return -1;
        const byName = a.sortName.localeCompare(b.sortName);
        if (byName !== 0) return byName;
      }
      return compareText(a.row.shift_date, b.row.shift_date);
    })
    .map((entry) => entry.row);

  return rows;
});
