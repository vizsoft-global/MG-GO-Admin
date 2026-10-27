import { HttpsError, onCall } from "firebase-functions/v2/https";
import { measureOnCall } from "../core/fs-metrics";
import { getFirestore, type Query } from "../core/fs";
import { COLLECTIONS, FIELDS } from "../core/collections";
import { kuwaitDayEnd, kuwaitDayStart, kuwaitDayString } from "../core/kuwait";
import { parseId, parseIdList } from "../core/query";
import { requireStaff, requireStaffFresh } from "../core/staff";
import { overlayZoneMonthDocs } from "../core/rollups";
import { EMPTY_ROW, asDate, loadAllDocs, loadDocMap, num, toRow, type Row } from "./fleet";
import { loadNationalityLabels, nationalityLabel } from "../core/nationality-label";
import {
  deliveryMinutes,
  efficiencyBenchmarkMode,
  positiveRatio,
  primaryRestaurantId,
  type EfficiencyBenchmark,
} from "../core/ops-kpi";
import {
  fullPopulationDpds,
  onShiftHoursByDriver,
  type AttendanceLogInput,
  type ShiftSessionInput,
} from "../core/ops-hours";

const PERFORMANCE_TARGET_DPD = "performance_target_dpd";
const DRIVER_DPD_SHIFT_NOTICES = "driver_dpd_shift_notices";

const RANGE_CAP_DAYS = 400;
const GPS_OFFLINE_SECONDS = 150;
const LOW_BATTERY_PCT = 15;

type Dict = Record<string, unknown>;

type DailyDpdState = {
  target: number | null;
  completed_today: number;
  progress_today: number;
  remaining: number;
  achieved: boolean;
  rule_id: string | null;
  restaurant_id: string | null;
  restaurant_name: string | null;
  company_name: string | null;
  shift_date: string;
};

function dictMap(rows: readonly Row[]): Map<string, Dict> {
  const out = new Map<string, Dict>();
  for (const row of rows) out.set(row.id, row);
  return out;
}

/**
 * Only the fields a snapshot reads come off the wire. A month of deliveries is
 * tens of thousands of documents and the container runs at 1 GiB; selecting the
 * four columns the roll needs is what keeps that inside the limit.
 */
async function loadLeanDocs(collection: string, fields: readonly string[]): Promise<Row[]> {
  const snap = await getFirestore().collection(collection).select(...fields).get();
  return snap.docs.map((doc) => toRow(doc.id, doc.data() as Dict));
}

/** `getAll` takes a bounded batch; a fleet-sized id list is fetched in chunks. */
async function loadDocsInChunks(collection: string, ids: readonly string[]): Promise<Map<string, Dict>> {
  const unique = Array.from(new Set(ids.filter((id) => id.length > 0)));
  const out = new Map<string, Dict>();
  for (let index = 0; index < unique.length; index += 300) {
    const slice = unique.slice(index, index + 300);
    const batch = await loadDocMap(collection, slice);
    for (const [id, row] of batch) out.set(id, row as Dict);
  }
  return out;
}

function text(row: Dict, key: string): string | null {
  const value = row[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function dayDiff(from: string, to: string): number {  return Math.round((kuwaitDayStart(to).getTime() - kuwaitDayStart(from).getTime()) / 86400000);
}

function addDays(day: string, delta: number): string {
  return kuwaitDayString(kuwaitDayStart(day).getTime() + delta * 86400000 + 3600000);
}

function requireDay(value: unknown, field: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new HttpsError("invalid-argument", `invalid_${field}`);
  }
  const [y, m, d] = raw.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new HttpsError("invalid-argument", `invalid_${field}`);
  }
  return raw;
}

function optionalDay(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return requireDay(value, field);
}

/** `_driver_shift_end_at` — the latest session end of a submitted shift. */
function shiftEndAt(shift: Dict): Date | null {
  const day = typeof shift.shift_date === "string" ? shift.shift_date : "";
  if (!day) return null;
  let end: Date | null = null;
  for (const prefix of ["session1", "session2"] as const) {
    const raw = shift[`${prefix}_end`];
    if (raw === null || raw === undefined || raw === "") continue;
    const offset = num(shift[`${prefix}_end_day_offset`]) ?? 0;
    const base = addDays(day, offset);
    const text = typeof raw === "string" ? raw : null;
    let candidate: Date | null = null;
    if (text && /^\d{1,2}:\d{2}/.test(text)) {
      const [hours, minutes] = text.split(":").map(Number);
      candidate = new Date(
        kuwaitDayStart(base).getTime() + hours * 3600000 + minutes * 60000,
      );
    } else {
      const parsed = asDate(raw);
      candidate = parsed ?? null;
    }
    if (candidate && (!end || candidate.getTime() > end.getTime())) end = candidate;
  }
  return end;
}

async function loadShift(driverId: string, day: string): Promise<Dict | null> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.driverDailyShifts)
    .where("driver_id", "==", driverId)
    .where("shift_date", "==", day)
    .limit(1)
    .get();
  return snap.empty ? null : (snap.docs[0].data() as Dict);
}

async function countDeliveries(
  driverId: string,
  field: string,
  day: string,
  statuses: readonly string[] | null,
): Promise<number> {
  let query: Query = getFirestore()
    .collection(COLLECTIONS.deliveries)
    .where("driver_id", "==", driverId)
    .where(field, ">=", kuwaitDayStart(day))
    .where(field, "<", kuwaitDayEnd(day));
  if (statuses && statuses.length === 1) query = query.where("status", "==", statuses[0]);
  const snap = await query.get();
  if (!statuses) return snap.size;
  return snap.docs.filter((doc) => statuses.includes(String((doc.data() as Dict).status))).length;
}

/**
 * `_driver_daily_dpd_state` — the rider's target for the day, the verified count,
 * and the in-flight count. Target resolves restaurant rule first, then zone.
 */
async function driverDailyDpdState(driverId: string, day: string): Promise<DailyDpdState> {
  const db = getFirestore();
  const driverSnap = await db.collection(COLLECTIONS.drivers).doc(driverId).get();
  if (!driverSnap.exists) return emptyDailyDpdState(day);
  const driver = driverSnap.data() as Dict;

  const restaurantId = parseId(driver.restaurant_id);
  const zoneId = parseId(driver.zone_id);

  const ruleSnap = await db
    .collection(COLLECTIONS.deliveryRules)
    .where("status", "==", "active")
    .get();
  const rules = ruleSnap.docs.map((doc) => toRow(doc.id, doc.data() as Dict));

  const scopesSnap = await db.collection(COLLECTIONS.deliveryRuleScopes).get();
  const scopeByRule = new Map<string, { restaurantId: string | null; zoneId: string | null }>();
  for (const doc of scopesSnap.docs) {
    const row = doc.data() as Dict;
    const ruleId = parseId(row.delivery_rule_id) ?? parseId(row.rule_id);
    if (!ruleId) continue;
    scopeByRule.set(ruleId, {
      restaurantId: parseId(row.restaurant_id),
      zoneId: parseId(row.zone_id),
    });
  }

  let winner: Dict | null = null;
  for (const rule of rules) {
    const scope = scopeByRule.get(String(rule.id)) ?? { restaurantId: null, zoneId: null };
    if (scope.restaurantId && restaurantId && scope.restaurantId === restaurantId) {
      if (!winner || (num(rule.priority) ?? 0) >= (num(winner.priority) ?? 0)) {
        winner = rule;
      }
    }
  }
  if (!winner) {
    for (const rule of rules) {
      const scope = scopeByRule.get(String(rule.id)) ?? { restaurantId: null, zoneId: null };
      if (scope.zoneId && zoneId && scope.zoneId === zoneId) {
        if (!winner || (num(rule.priority) ?? 0) >= (num(winner.priority) ?? 0)) {
          winner = rule;
        }
      }
    }
  }

  const target = winner ? num(winner.dpd_target) : null;

  const [completed, progress, earningsSnap, restaurantDoc] = await Promise.all([
    countDeliveries(driverId, FIELDS.deliveries.deliveredAt, day, ["verified"]),
    countDeliveries(driverId, FIELDS.deliveries.createdAt, day, ["in_transit", "pending", "under_review"]),
    db
      .collection(COLLECTIONS.driverEarningsDaily)
      .where("driver_id", "==", driverId)
      .where("earn_date", "==", day)
      .limit(1)
      .get(),
    restaurantId
      ? db.collection(COLLECTIONS.restaurants).doc(restaurantId).get()
      : Promise.resolve(null),
  ]);

  const restaurant = restaurantDoc && restaurantDoc.exists ? (restaurantDoc.data() as Dict) : null;
  void earningsSnap;

  return {
    target,
    completed_today: completed,
    progress_today: progress,
    remaining: target === null ? 0 : Math.max(0, target - completed),
    achieved: target !== null && completed >= target,
    rule_id: winner ? String(winner.id) : null,
    restaurant_id: restaurantId,
    restaurant_name: restaurant ? ((restaurant.name as string | null) ?? null) : null,
    company_name: null,
    shift_date: day,
  };
}

function emptyDailyDpdState(day: string): DailyDpdState {
  return {
    target: null,
    completed_today: 0,
    progress_today: 0,
    remaining: 0,
    achieved: false,
    rule_id: null,
    restaurant_id: null,
    restaurant_name: null,
    company_name: null,
    shift_date: day,
  };
}

export const adminPerformanceOpsBounds = onCall(async (request) => {
  await requireStaff(request);

  const today = kuwaitDayString(new Date());
  const snap = await getFirestore()
    .collection(COLLECTIONS.deliveries)
    .where("status", "==", "verified")
    .orderBy(FIELDS.deliveries.deliveredAt, "asc")
    .limit(1)
    .get();

  const first = snap.empty
    ? null
    : kuwaitDayString(asDate((snap.docs[0].data() as Dict).delivered_at) ?? new Date());

  const spanDays = first === null ? 0 : dayDiff(first, today) + 1;

  return {
    today,
    first_delivery_date: first,
    span_days: spanDays,
    over_cap: spanDays > RANGE_CAP_DAYS,
  };
});

export const adminListPerformanceTargetDpd = onCall(async (request) => {
  await requireStaff(request);

  const snap = await getFirestore().collection(PERFORMANCE_TARGET_DPD).get();
  return snap.docs
    .map((doc) => toRow(doc.id, doc.data() as Dict))
    .filter((row) => !row.zone_id && !row.team_key)
    .map((row) => ({
      id: row.id,
      month: (row.month as string | null) ?? null,
      target: num(row.target),
    }))
    .sort((a, b) => String(b.month ?? "").localeCompare(String(a.month ?? "")));
});

export const adminUpsertPerformanceTargetDpd = onCall(async (request) => {
  await requireStaffFresh(request);

  const data = (request.data ?? {}) as Dict;
  const month = requireDay(data.month, "month").slice(0, 7) + "-01";
  const target = num(data.target);
  if (target === null || target <= 0) {
    throw new HttpsError("invalid-argument", "invalid_target");
  }

  const db = getFirestore();
  const existing = await db
    .collection(PERFORMANCE_TARGET_DPD)
    .where("month", "==", month)
    .get();
  const match = existing.docs.find((doc) => {
    const row = doc.data() as Dict;
    return !row.zone_id && !row.team_key;
  });

  if (match) {
    await match.ref.set({ target, updated_at: new Date() }, { merge: true });
    return { ok: true, id: match.id, month, target };
  }

  const created = await db
    .collection(PERFORMANCE_TARGET_DPD)
    .add({ month, target, zone_id: null, team_key: null, created_at: new Date(), updated_at: new Date() });
  return { ok: true, id: created.id, month, target };
});

export const adminDpdLiveSnapshot = onCall(async (request) => {
  await requireStaff(request);

  const data = (request.data ?? {}) as Dict;
  const day = optionalDay(data.date, "date") ?? kuwaitDayString(new Date());
  const start = kuwaitDayStart(day);
  const end = kuwaitDayEnd(day);
  const now = new Date();

  const db = getFirestore();

  const [dayDeliveriesSnap, driverSnaps, zoneDocs, partnerDocs, attendanceSnap, locationDocs] =
    await Promise.all([
      db
        .collection(COLLECTIONS.deliveries)
        .where(FIELDS.deliveries.createdAt, ">=", start)
        .where(FIELDS.deliveries.createdAt, "<", end)
        .get(),
      db.collection(COLLECTIONS.drivers).where("archived_at", "==", null).get(),
      loadAllDocs(COLLECTIONS.zones),
      loadAllDocs(COLLECTIONS.partners),
      db.collection(COLLECTIONS.attendanceLogs).where("log_date", "==", day).get(),
      loadAllDocs(COLLECTIONS.driverLocations),
    ]);

  const byStatus = new Map<string, number>();
  const perDriver = new Map<string, { submitted: number; verified: number; in_transit: number }>();
  for (const doc of dayDeliveriesSnap.docs) {
    const row = doc.data() as Dict;
    const status = String(row.status ?? "");
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    const driverId = parseId(row.driver_id);
    if (!driverId) continue;
    const entry = perDriver.get(driverId) ?? { submitted: 0, verified: 0, in_transit: 0 };
    entry.submitted += 1;
    if (status === "verified") entry.verified += 1;
    if (status === "in_transit") entry.in_transit += 1;
    perDriver.set(driverId, entry);
  }

  const checkedIn = new Set<string>();
  for (const doc of attendanceSnap.docs) {
    const row = doc.data() as Dict;
    if (row.check_in_at) checkedIn.add(String(row.driver_id));
  }

  const locationById = dictMap(locationDocs);
  const zoneById = dictMap(zoneDocs);
  const partnerById = dictMap(partnerDocs);
  const driverById = new Map<string, Dict>();
  for (const doc of driverSnaps.docs) driverById.set(doc.id, doc.data() as Dict);
  const profileById = await loadDocMap(COLLECTIONS.profiles, driverSnaps.docs.map((d) => d.id));

  let activeDrivers = 0;
  let onDuty = 0;
  let trackingLive = 0;
  for (const doc of driverSnaps.docs) {
    const driver = doc.data() as Dict;
    if (driver.status === "active") activeDrivers += 1;
    if (driver.is_on_duty) {
      onDuty += 1;
      const lastReport = asDate(locationById.get(doc.id)?.last_report_at);
      if (lastReport && lastReport.getTime() > now.getTime() - GPS_OFFLINE_SECONDS * 1000) {
        trackingLive += 1;
      }
    }
  }

  let outOfZone = 0;
  let gpsOffline = 0;
  let lowBattery = 0;
  for (const doc of driverSnaps.docs) {
    const driver = doc.data() as Dict;
    if (!driver.is_on_duty) continue;
    const location = locationById.get(doc.id) ?? EMPTY_ROW;
    if (location.out_of_zone_since) outOfZone += 1;
    const lastReport = asDate(location.last_report_at);
    if (!lastReport || lastReport.getTime() <= now.getTime() - GPS_OFFLINE_SECONDS * 1000) {
      gpsOffline += 1;
    }
    const battery = num(location.battery_pct);
    if (battery !== null && battery <= LOW_BATTERY_PCT) lowBattery += 1;
  }

  const leaderboard = Array.from(perDriver.entries())
    .map(([driverId, counts]) => {
      const driver = driverById.get(driverId) ?? EMPTY_ROW;
      const profile = profileById.get(driverId) ?? EMPTY_ROW;
      const zone = driver.zone_id ? zoneById.get(String(driver.zone_id)) : undefined;
      const partner = driver.partner_id ? partnerById.get(String(driver.partner_id)) : undefined;
      const fullName = typeof profile.full_name === "string" ? profile.full_name : "";
      return {
        driver_id: driverId,
        driver_name: fullName.length ? fullName : "—",
        driver_code: (driver.driver_code as string | null) ?? null,
        zone_name: zone ? ((zone.name as string | null) ?? null) : null,
        partner_name: partner ? ((partner.name as string | null) ?? null) : null,
        is_on_duty: Boolean(driver.is_on_duty),
        submitted: counts.submitted,
        verified: counts.verified,
        in_transit: counts.in_transit,
      };
    })
    .filter((row) => driverById.has(row.driver_id))
    .sort(
      (a, b) =>
        b.verified - a.verified ||
        b.submitted - a.submitted ||
        String(a.driver_name).localeCompare(String(b.driver_name)),
    )
    .slice(0, 10);

  const zoneDeliveries = new Map<string, number>();
  for (const doc of dayDeliveriesSnap.docs) {
    const zoneId = parseId((doc.data() as Dict).zone_id);
    zoneDeliveries.set(zoneId ?? "", (zoneDeliveries.get(zoneId ?? "") ?? 0) + 1);
  }
  const zoneRiders = new Map<string, number>();
  for (const doc of driverSnaps.docs) {
    const driver = doc.data() as Dict;
    const zoneId = parseId(driver.zone_id) ?? "";
    if (driver.is_on_duty) zoneRiders.set(zoneId, (zoneRiders.get(zoneId) ?? 0) + 1);
  }
  const zones = Array.from(new Set([...zoneDeliveries.keys(), ...zoneRiders.keys()]))
    .map((id) => {
      const zone = id ? zoneById.get(id) : undefined;
      return {
        id: id.length ? id : null,
        label: zone ? ((zone.name as string | null) ?? null) : null,
        deliveries: zoneDeliveries.get(id) ?? 0,
        on_duty: zoneRiders.get(id) ?? 0,
      };
    })
    .filter((row) => row.deliveries > 0 || row.on_duty > 0)
    .sort(
      (a, b) =>
        b.deliveries - a.deliveries ||
        b.on_duty - a.on_duty ||
        String(a.label ?? "").localeCompare(String(b.label ?? "")),
    )
    .slice(0, 12);

  const partnerDeliveries = new Map<string, number>();
  for (const doc of dayDeliveriesSnap.docs) {
    const partnerId = parseId((doc.data() as Dict).partner_id);
    partnerDeliveries.set(partnerId ?? "", (partnerDeliveries.get(partnerId ?? "") ?? 0) + 1);
  }
  const partnerRiders = new Map<string, number>();
  for (const doc of driverSnaps.docs) {
    const driver = doc.data() as Dict;
    const partnerId = parseId(driver.partner_id) ?? "";
    if (driver.is_on_duty) {
      partnerRiders.set(partnerId, (partnerRiders.get(partnerId) ?? 0) + 1);
    }
  }
  const partners = Array.from(new Set([...partnerDeliveries.keys(), ...partnerRiders.keys()]))
    .map((id) => {
      const partner = id ? partnerById.get(id) : undefined;
      return {
        id: id.length ? id : null,
        label: partner ? ((partner.name as string | null) ?? null) : null,
        deliveries: partnerDeliveries.get(id) ?? 0,
        on_duty: partnerRiders.get(id) ?? 0,
      };
    })
    .filter((row) => row.deliveries > 0 || row.on_duty > 0)
    .sort(
      (a, b) =>
        b.deliveries - a.deliveries ||
        b.on_duty - a.on_duty ||
        String(a.label ?? "").localeCompare(String(b.label ?? "")),
    )
    .slice(0, 12);

  return {
    date: day,
    generated_at: now.toISOString(),
    deliveries: {
      created: dayDeliveriesSnap.size,
      in_transit: byStatus.get("in_transit") ?? 0,
      pending: byStatus.get("pending") ?? 0,
      under_review: byStatus.get("under_review") ?? 0,
      verified: byStatus.get("verified") ?? 0,
      rejected: byStatus.get("rejected") ?? 0,
      cancelled: byStatus.get("cancelled") ?? 0,
    },
    roster: {
      active_drivers: activeDrivers,
      total_drivers: driverSnaps.size,
      on_duty: onDuty,
      tracking_live: trackingLive,
      checked_in: checkedIn.size,
    },
    alerts: {
      out_of_zone: outOfZone,
      gps_offline: gpsOffline,
      low_battery: lowBattery,
    },
    leaderboard,
    zones,
    partners,
    score: {},
  };
});

export const claimDpdShiftNotice = onCall(async (request) => {
  await requireStaff(request);

  const data = (request.data ?? {}) as Dict;
  const driverId = parseId(data.driverId);
  const shiftDate = requireDay(data.shiftDate, "shift_date");
  const kind = parseId(data.kind);
  if (!driverId || !kind) throw new HttpsError("invalid-argument", "invalid_claim");

  const ref = getFirestore()
    .collection(DRIVER_DPD_SHIFT_NOTICES)
    .doc(`${driverId}_${shiftDate}_${kind}`);
  try {
    await ref.create({ driver_id: driverId, shift_date: shiftDate, kind, created_at: new Date() });
    return true;
  } catch (error) {
    const code = (error as { code?: number | string }).code;
    if (code === 6 || code === "already-exists") return false;
    throw error;
  }
});

export const adminDpdNoticeCandidates = onCall(async (request) => {
  await requireStaff(request);

  const data = (request.data ?? {}) as Dict;
  const now = asDate(data.now) ?? new Date();
  const driverIds = parseIdList(data.driverIds);
  const kinds = parseIdList(data.kinds);
  const today = kuwaitDayString(now);

  const db = getFirestore();
  const candidateDays = [today, addDays(today, -1)];

  const [shiftSnaps, attendanceSnaps] = await Promise.all([
    db.collection(COLLECTIONS.driverDailyShifts).where("shift_date", "in", candidateDays).get(),
    db.collection(COLLECTIONS.attendanceLogs).where("log_date", "==", today).get(),
  ]);

  const pairs = new Map<string, { driverId: string; day: string }>();
  for (const doc of shiftSnaps.docs) {
    const row = doc.data() as Dict;
    const driverId = parseId(row.driver_id);
    const day = typeof row.shift_date === "string" ? row.shift_date : null;
    if (driverId && day) pairs.set(`${driverId}|${day}`, { driverId, day });
  }
  for (const doc of attendanceSnaps.docs) {
    const driverId = parseId((doc.data() as Dict).driver_id);
    if (driverId) pairs.set(`${driverId}|${today}`, { driverId, day: today });
  }
  if (driverIds) {
    for (const driverId of driverIds) pairs.set(`${driverId}|${today}`, { driverId, day: today });
  }

  const driverById = await loadDocMap(
    COLLECTIONS.drivers,
    Array.from(pairs.values()).map((pair) => pair.driverId),
  );
  const profileById = await loadDocMap(
    COLLECTIONS.profiles,
    Array.from(pairs.values()).map((pair) => pair.driverId),
  );

  const existingNotices = await db
    .collection(DRIVER_DPD_SHIFT_NOTICES)
    .where("shift_date", "in", candidateDays)
    .get();
  const claimed = new Set<string>();
  for (const doc of existingNotices.docs) {
    const row = doc.data() as Dict;
    claimed.add(`${row.driver_id}|${row.shift_date}|${row.kind}`);
  }

  const rows: Array<{
    driver_id: string;
    shift_date: string;
    kind: string;
    target: number;
    completed: number;
    incentive_kwd: number;
    minutes_left: number | null;
    locale: string | null;
  }> = [];

  for (const { driverId, day } of pairs.values()) {
    const driver = driverById.get(driverId);
    if (!driver) continue;
    if (driver.archived_at) continue;
    if (driver.status !== "active") continue;
    if (driver.is_blocked === true) continue;
    if (driverIds && !driverIds.includes(driverId)) continue;

    const state = await driverDailyDpdState(driverId, day);
    if (state.target === null || state.target <= 0) continue;

    const shift = await loadShift(driverId, day);
    const end = shift ? shiftEndAt(shift) : null;

    if (day < today && (!end || now.getTime() > end.getTime() + 6 * 3600000)) continue;

    const wantsKind = (kind: string) => !kinds || kinds.includes(kind);
    const profile = profileById.get(driverId) ?? EMPTY_ROW;
    const locale = typeof profile.locale === "string" ? profile.locale : null;

    if (
      wantsKind("warning") &&
      end &&
      now.getTime() >= end.getTime() - 30 * 60000 &&
      now.getTime() < end.getTime() &&
      state.completed_today < state.target &&
      driver.is_on_duty === true &&
      !claimed.has(`${driverId}|${day}|warning`)
    ) {
      rows.push({
        driver_id: driverId,
        shift_date: day,
        kind: "warning",
        target: state.target,
        completed: state.completed_today,
        incentive_kwd: 0,
        minutes_left: Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 60000)),
        locale,
      });
      continue;
    }

    if (
      wantsKind("congrats") &&
      day === today &&
      state.completed_today >= state.target &&
      !claimed.has(`${driverId}|${day}|congrats`)
    ) {
      rows.push({
        driver_id: driverId,
        shift_date: day,
        kind: "congrats",
        target: state.target,
        completed: state.completed_today,
        incentive_kwd: 0,
        minutes_left: null,
        locale,
      });
      continue;
    }

    if (wantsKind("summary")) {
      const earningsSnap = await db
        .collection(COLLECTIONS.driverEarningsDaily)
        .where("driver_id", "==", driverId)
        .where("earn_date", "==", day)
        .limit(1)
        .get();
      const incentive = earningsSnap.empty
        ? 0
        : num((earningsSnap.docs[0].data() as Dict).incentive_kwd) ?? 0;

      const attendanceSnap = await db
        .collection(COLLECTIONS.attendanceLogs)
        .where("driver_id", "==", driverId)
        .where("log_date", "==", day)
        .get();
      const checkedOut = attendanceSnap.docs.some((doc) => Boolean((doc.data() as Dict).check_out_at));

      const closed =
        (end !== null && now.getTime() >= end.getTime()) ||
        (driver.is_on_duty !== true &&
          checkedOut &&
          (end === null || now.getTime() >= end.getTime() - 30 * 60000));

      if (closed && incentive > 0 && !claimed.has(`${driverId}|${day}|summary`)) {
        rows.push({
          driver_id: driverId,
          shift_date: day,
          kind: "summary",
          target: state.target,
          completed: state.completed_today,
          incentive_kwd: incentive,
          minutes_left: null,
          locale,
        });
      }
    }
  }

  return rows;
});

type RiderRoll = {
  driver_id: string;
  driver_name: string | null;
  driver_code: string | null;
  employee_id: string | null;
  zone_id: string | null;
  zone_name: string | null;
  restaurant_id: string | null;
  store_name: string | null;
  partner_id: string | null;
  partner_key: string | null;
  partner_label: string | null;
  vehicle_key: string | null;
  nationality: string | null;
  project_key: string | null;
  source_type: string | null;
  source_company: string | null;
  orders: number;
  working_days: number;
  dpd: number | null;
  target_dpd: number | null;
  dpd_eff: number | null;
  tgt_eff: number | null;
  working_hours: number;
  delivery_minutes: number;
  delivery_count: number;
  utr: number | null;
  avg_delivery_min: number | null;
  store_dpd: number | null;
  veh_zone_dpd: number | null;
  benchmark_mode: EfficiencyBenchmark;
};

type OpsArgs = {
  from: string;
  to: string;
  zoneIds: string[] | null;
  partnerIds: string[] | null;
  restaurantIds: string[] | null;
  nationalities: string[] | null;
  vehicleKeys: string[] | null;
  companyIds: string[] | null;
  driverStatuses: string[] | null;
  partnerMode: string;
  prevFrom: string | null;
  prevTo: string | null;
  projectKeys: string[] | null;
  sourceTypes: string[] | null;
  orderStatuses: string[];
  outsourceOnly: boolean;
  bucket: "day" | "week" | "month";
};

function countedStatuses(value: unknown): string[] {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "all") return ["pending", "in_transit", "verified"];
  if (raw === "pending" || raw === "in_transit" || raw === "verified") return [raw];
  return ["verified"];
}

function readOpsArgs(data: Dict): OpsArgs {
  const from = requireDay(data.from, "from");
  const to = requireDay(data.to, "to");
  if (dayDiff(from, to) < 0) throw new HttpsError("invalid-argument", "invalid_date_range");
  if (dayDiff(from, to) + 1 > RANGE_CAP_DAYS) {
    throw new HttpsError("invalid-argument", "range_too_large");
  }
  const bucketRaw = typeof data.bucket === "string" ? data.bucket.toLowerCase() : "day";
  const bucket: "day" | "week" | "month" =
    bucketRaw === "week" ? "week" : bucketRaw === "month" ? "month" : "day";
  return {
    from,
    to,
    zoneIds: parseIdList(data.zoneIds),
    partnerIds: parseIdList(data.partnerIds),
    restaurantIds: parseIdList(data.restaurantIds),
    nationalities: parseIdList(data.nationalities),
    vehicleKeys: parseIdList(data.vehicleKeys),
    companyIds: parseIdList(data.companyIds) ?? parseIdList(data.sourceCompanies),
    driverStatuses: parseIdList(data.driverStatuses),
    partnerMode: typeof data.partnerMode === "string" ? data.partnerMode : "all",
    prevFrom: optionalDay(data.prevFrom, "prev_from"),
    prevTo: optionalDay(data.prevTo, "prev_to"),
    projectKeys: parseIdList(data.projectKeys),
    sourceTypes: parseIdList(data.sourceTypes),
    orderStatuses: countedStatuses(data.orderStatus),
    outsourceOnly: data.outsourceOnly === true,
    bucket,
  };
}

/**
 * The Orders/DPD roll shared by both snapshot RPCs.
 *
 * Orders follow `orderStatuses`. The default is verified, and that path still
 * reads only `delivered_at` inside `[from, to)`. Working day = a distinct Kuwait
 * day with at least one counted order. Delivery time is
 * `delivered_at − started_to_restaurant_at`, or `pickup_at` when the heading
 * stamp is absent. Vehicle comes from `vehicles.vehicle_type_key` through the
 * assignment only; a rider with no vehicle reads as `—`, never Bike.
 */
async function buildRoll(args: OpsArgs): Promise<{
  riders: RiderRoll[];
  stores: Array<Dict>;
  zones: Array<Dict>;
  zoneRestaurants: Array<Dict>;
  deliveries: Dict[];
  driverById: Map<string, Dict>;
  zoneById: Map<string, Dict>;
  partnerById: Map<string, Dict>;
  restaurantById: Map<string, Dict>;
  nationalities: string[];
  targetDpd: number;
  workingHours: number;
  hoursByDay: Map<string, number>;
}> {
  const db = getFirestore();
  const wantsDelivered = args.orderStatuses.some((status) => status === "verified" || status === "pending");
  const wantsOpen = args.orderStatuses.includes("in_transit");
  const [driverSnaps, deliverySnaps, openSnaps, attendanceSnaps, ruleSnaps, scopeSnaps, vehicleDocs, restaurantDocs, zoneDocs, partnerDocs, targetSnaps, shiftSnaps, verifiedSnaps] =
    await Promise.all([
      db
        .collection(COLLECTIONS.drivers)
        .where("archived_at", "==", null)
        .select(
          "zone_id",
          "zone_name",
          "partner_id",
          "partner_name",
          "project_key",
          "vehicle_id",
          "vehicle_type_key",
          "profile_id",
          "name",
          "driver_code",
          "employee_id",
          "restaurant_id",
          "nationality",
          "nationality_category_keys",
          "status",
          "source_type",
          "source_company",
        )
        .get(),
      wantsDelivered
        ? db
            .collection(COLLECTIONS.deliveries)
            .where(FIELDS.deliveries.deliveredAt, ">=", kuwaitDayStart(args.from))
            .where(FIELDS.deliveries.deliveredAt, "<", kuwaitDayEnd(args.to))
            .select("status", "driver_id", "delivered_at", "pickup_at", "restaurant_id", "started_to_restaurant_at")
            .get()
        : Promise.resolve(null),
      wantsOpen
        ? db
            .collection(COLLECTIONS.deliveries)
            .where(FIELDS.deliveries.pickupAt, ">=", kuwaitDayStart(args.from))
            .where(FIELDS.deliveries.pickupAt, "<", kuwaitDayEnd(args.to))
            .select("status", "driver_id", "delivered_at", "pickup_at", "restaurant_id", "started_to_restaurant_at")
            .get()
        : Promise.resolve(null),
      db
        .collection(COLLECTIONS.attendanceLogs)
        .where(FIELDS.attendanceLogs.logDate, ">=", args.from)
        .where(FIELDS.attendanceLogs.logDate, "<=", args.to)
        .select("driver_id", "log_date", "worked_minutes", "check_in_at", "check_out_at")
        .get(),
      db.collection(COLLECTIONS.deliveryRules).get(),
      db.collection(COLLECTIONS.deliveryRuleScopes).get(),
      loadLeanDocs(COLLECTIONS.vehicles, ["vehicle_type_key"]),
      loadLeanDocs(COLLECTIONS.restaurants, ["name", "is_active"]),
      loadLeanDocs(COLLECTIONS.zones, ["name"]),
      loadLeanDocs(COLLECTIONS.partners, ["slug", "key", "name", "efficiency_benchmark", "logo_url"]),
      db.collection(PERFORMANCE_TARGET_DPD).get(),
      db
        .collection(COLLECTIONS.driverDailyShifts)
        .where("shift_date", ">=", args.from)
        .where("shift_date", "<=", args.to)
        .select(
          "driver_id",
          "shift_date",
          "is_off",
          "shift_type",
          "session1_start",
          "session1_end",
          "session1_end_day_offset",
          "session2_start",
          "session2_end",
          "session2_start_day_offset",
          "session2_end_day_offset",
        )
        .get(),
      wantsDelivered
        ? Promise.resolve(null)
        : db
            .collection(COLLECTIONS.deliveries)
            .where(FIELDS.deliveries.deliveredAt, ">=", kuwaitDayStart(args.from))
            .where(FIELDS.deliveries.deliveredAt, "<", kuwaitDayEnd(args.to))
            .where("status", "==", "verified")
            .select("status", "driver_id", "delivered_at", "pickup_at", "restaurant_id", "started_to_restaurant_at")
            .get(),
    ]);

  const deliveryRows: Dict[] = [];
  const seenDelivery = new Set<string>();
  const pushDelivery = (doc: { id: string; data: () => Dict }, allowed: ReadonlySet<string>) => {
    if (seenDelivery.has(doc.id)) return;
    const row = doc.data();
    const status = typeof row.status === "string" ? row.status : "";
    if (!allowed.has(status)) return;
    seenDelivery.add(doc.id);
    deliveryRows.push({
      id: doc.id,
      status,
      driver_id: row.driver_id,
      delivered_at: row.delivered_at,
      pickup_at: row.pickup_at,
      restaurant_id: row.restaurant_id,
      started_to_restaurant_at: row.started_to_restaurant_at,
      day: null,
      minutes: null,
    });
  };
  const deliveredAllowed = new Set(args.orderStatuses.filter((status) => status === "verified" || status === "pending"));
  const openAllowed = new Set(args.orderStatuses.filter((status) => status === "in_transit"));
  for (const doc of deliverySnaps?.docs ?? []) pushDelivery(doc, deliveredAllowed);
  for (const doc of openSnaps?.docs ?? []) pushDelivery(doc, openAllowed);

  const driverIds = driverSnaps.docs.map((doc) => doc.id);
  const profileById = await loadDocsInChunks(COLLECTIONS.profiles, driverIds);
  const profileIds = driverSnaps.docs
    .map((doc) => text(doc.data() as Dict, "profile_id"))
    .filter((id): id is string => id !== null);
  const extraProfiles = await loadDocsInChunks(
    COLLECTIONS.profiles,
    profileIds.filter((id) => !profileById.has(id)),
  );
  for (const [id, row] of extraProfiles) profileById.set(id, row);

  const vehicleById = dictMap(vehicleDocs);
  const restaurantById = dictMap(restaurantDocs);
  const zoneById = dictMap(zoneDocs);
  const partnerById = dictMap(partnerDocs);
  const partnerBySlug = new Map<string, Dict>();
  for (const partner of partnerDocs) {
    const slug = text(partner, "slug") ?? text(partner, "key");
    if (slug) partnerBySlug.set(slug.toLowerCase(), partner);
  }

  const globalTargets = targetSnaps.docs
    .map((doc) => toRow(doc.id, doc.data() as Dict))
    .filter((row) => !row.zone_id && !row.team_key)
    .map((row) => ({ month: (row.month as string | null) ?? null, target: num(row.target) ?? 25 }))
    .sort((a, b) => String(b.month ?? "").localeCompare(String(a.month ?? "")));
  const targetDpd = globalTargets.length ? globalTargets[0].target : 25;

  const scopeByRule = new Map<string, { restaurantId: string | null; zoneId: string | null }>();
  for (const doc of scopeSnaps.docs) {
    const row = doc.data() as Dict;
    const ruleId = parseId(row.delivery_rule_id) ?? parseId(row.rule_id);
    if (!ruleId) continue;
    scopeByRule.set(ruleId, {
      restaurantId: parseId(row.restaurant_id),
      zoneId: parseId(row.zone_id),
    });
  }
  const ruleTarget = new Map<string, number>();
  for (const doc of ruleSnaps.docs) {
    const row = doc.data() as Dict;
    const dpd = num(row.dpd_target);
    if (dpd !== null) ruleTarget.set(doc.id, dpd);
  }
  const restaurantRuleTarget = new Map<string, number>();
  const zoneRuleTarget = new Map<string, number>();
  for (const [ruleId, scope] of scopeByRule) {
    const dpd = ruleTarget.get(ruleId);
    if (dpd === undefined) continue;
    if (scope.restaurantId) restaurantRuleTarget.set(scope.restaurantId, dpd);
    if (scope.zoneId) zoneRuleTarget.set(scope.zoneId, dpd);
  }

  const driverById = new Map<string, Dict>();
  for (const doc of driverSnaps.docs) driverById.set(doc.id, toRow(doc.id, doc.data() as Dict));
  const nationalityLabels = await loadNationalityLabels("en");
  for (const driver of driverById.values()) {
    const stored = typeof driver.nationality === "string" ? driver.nationality : null;
    const label = nationalityLabel(driver.nationality_category_keys, nationalityLabels, stored);
    if (label) driver.nationality = label;
  }

  const perDriver = new Map<
    string,
    {
      orders: number;
      days: Set<string>;
      counts: Map<string, number>;
      lastRestaurantId: string | null;
      lastAt: number;
      minutes: number;
      timed: number;
    }
  >();
  for (const row of deliveryRows) {
    const driverId = parseId(row.driver_id);
    if (!driverId) continue;
    const entry = perDriver.get(driverId) ?? {
      orders: 0,
      days: new Set<string>(),
      counts: new Map<string, number>(),
      lastRestaurantId: null,
      lastAt: 0,
      minutes: 0,
      timed: 0,
    };
    entry.orders += 1;
    const deliveredAt = asDate(row.delivered_at);
    const pickupAt = asDate(row.pickup_at);
    const started = asDate(row.started_to_restaurant_at);
    const day = deliveredAt ? kuwaitDayString(deliveredAt) : pickupAt ? kuwaitDayString(pickupAt) : null;
    if (day) entry.days.add(day);
    const minutes = deliveryMinutes(started ?? pickupAt, deliveredAt);
    row.day = day;
    row.minutes = minutes;
    if (minutes != null) {
      entry.minutes += minutes;
      entry.timed += 1;
    }
    const restaurantId = parseId(row.restaurant_id);
    const at = (deliveredAt ?? pickupAt)?.getTime() ?? 0;
    if (restaurantId) {
      entry.counts.set(restaurantId, (entry.counts.get(restaurantId) ?? 0) + 1);
      if (at >= entry.lastAt) {
        entry.lastAt = at;
        entry.lastRestaurantId = restaurantId;
      }
    }
    perDriver.set(driverId, entry);
  }

  const benchmarkOf = (driver: Dict, partner: Dict | undefined): EfficiencyBenchmark =>
    efficiencyBenchmarkMode({
      stored: text(partner ?? {}, "efficiency_benchmark"),
      projectKey: text(driver, "project_key"),
      partnerKey: text(partner ?? {}, "key") ?? text(partner ?? {}, "slug"),
      partnerName: text(partner ?? {}, "name"),
    });

  const resolvePartner = (
    driver: Dict,
  ): { id: string | null; key: string | null; label: string | null; benchmark: EfficiencyBenchmark } => {
    const directId = parseId(driver.partner_id);
    if (directId) {
      const partner = partnerById.get(directId);
      const slug = text(partner ?? {}, "slug") ?? text(partner ?? {}, "key");
      return {
        id: directId,
        key: slug ?? text(driver, "project_key"),
        label: text(partner ?? {}, "name") ?? text(driver, "partner_name"),
        benchmark: benchmarkOf(driver, partner),
      };
    }
    const projectKey = text(driver, "project_key");
    if (projectKey) {
      const partner = partnerBySlug.get(projectKey.toLowerCase());
      const slug = text(partner ?? {}, "slug") ?? text(partner ?? {}, "key");
      return {
        id: parseId(partner?.id),
        key: slug ?? projectKey,
        label: text(partner ?? {}, "name") ?? projectKey,
        benchmark: benchmarkOf(driver, partner),
      };
    }
    return {
      id: null,
      key: null,
      label: text(driver, "partner_name"),
      benchmark: benchmarkOf(driver, undefined),
    };
  };

  const resolveVehicleKey = (driver: Dict): string | null => {
    const vehicleId = parseId(driver.vehicle_id);
    const vehicle = vehicleId ? vehicleById.get(vehicleId) : undefined;
    return text(vehicle ?? {}, "vehicle_type_key") ?? text(driver, "vehicle_type_key");
  };

  type VerifiedEntry = {
    orders: number;
    days: Set<string>;
    counts: Map<string, number>;
    lastRestaurantId: string | null;
    lastAt: number;
  };
  const verifiedPerDriver = new Map<string, VerifiedEntry>();
  const verifiedDocs = wantsDelivered ? (deliverySnaps?.docs ?? []) : (verifiedSnaps?.docs ?? []);
  for (const doc of verifiedDocs) {
    const row = doc.data() as Dict;
    if (row.status !== "verified") continue;
    const driverId = parseId(row.driver_id);
    if (!driverId) continue;
    const entry = verifiedPerDriver.get(driverId) ?? {
      orders: 0,
      days: new Set<string>(),
      counts: new Map<string, number>(),
      lastRestaurantId: null,
      lastAt: 0,
    };
    entry.orders += 1;
    const deliveredAt = asDate(row.delivered_at);
    const pickupAt = asDate(row.pickup_at);
    const day = deliveredAt ? kuwaitDayString(deliveredAt) : pickupAt ? kuwaitDayString(pickupAt) : null;
    if (day) entry.days.add(day);
    const restaurantId = parseId(row.restaurant_id);
    const at = (deliveredAt ?? pickupAt)?.getTime() ?? 0;
    if (restaurantId) {
      entry.counts.set(restaurantId, (entry.counts.get(restaurantId) ?? 0) + 1);
      if (at >= entry.lastAt) {
        entry.lastAt = at;
        entry.lastRestaurantId = restaurantId;
      }
    }
    verifiedPerDriver.set(driverId, entry);
  }
  const benchRiders: Array<{
    restaurantId: string | null;
    zoneId: string | null;
    vehicleKey: string | null;
    orders: number;
    workingDays: number;
  }> = [];
  for (const [driverId, entry] of verifiedPerDriver) {
    const driver = driverById.get(driverId);
    if (!driver) continue;
    benchRiders.push({
      restaurantId: primaryRestaurantId(entry.counts, entry.lastRestaurantId) ?? parseId(driver.restaurant_id),
      zoneId: parseId(driver.zone_id),
      vehicleKey: resolveVehicleKey(driver),
      orders: entry.orders,
      workingDays: entry.days.size,
    });
  }
  const { storeDpd, zoneVehicleDpd } = fullPopulationDpds(benchRiders);

  const resolveDriverName = (driverId: string, driver: Dict): string | null => {
    const profileId = text(driver, "profile_id");
    const profile = profileById.get(driverId) ?? (profileId ? profileById.get(profileId) : undefined);
    return (
      text(profile ?? {}, "full_name") ??
      text(driver, "name") ??
      text(driver, "driver_code") ??
      null
    );
  };

  const riders: RiderRoll[] = [];
  for (const [driverId, entry] of perDriver) {
    const driver = driverById.get(driverId);
    if (!driver) continue;
    const zoneId = parseId(driver.zone_id);
    const restaurantId = primaryRestaurantId(entry.counts, entry.lastRestaurantId) ?? parseId(driver.restaurant_id);
    const zone = zoneId ? zoneById.get(zoneId) : undefined;
    const zoneName = text(zone ?? {}, "name") ?? text(driver, "zone_name");
    const partner = resolvePartner(driver);
    const target =
      (restaurantId ? restaurantRuleTarget.get(restaurantId) : undefined) ??
      (zoneId ? zoneRuleTarget.get(zoneId) : undefined) ??
      targetDpd;
    const workingDays = entry.days.size;
    const dpd = workingDays > 0 ? entry.orders / workingDays : null;
    riders.push({
      driver_id: driverId,
      driver_name: resolveDriverName(driverId, driver),
      driver_code: text(driver, "driver_code"),
      employee_id: text(driver, "employee_id"),
      zone_id: zoneId,
      zone_name: zoneName,
      restaurant_id: restaurantId,
      store_name: restaurantId ? ((restaurantById.get(restaurantId)?.name as string | null) ?? null) : null,
      partner_id: partner.id,
      partner_key: partner.key,
      partner_label: partner.label,
      vehicle_key: resolveVehicleKey(driver),
      nationality: text(driver, "nationality"),
      project_key: text(driver, "project_key"),
      source_type: text(driver, "source_type"),
      source_company: text(driver, "source_company"),
      orders: entry.orders,
      working_days: workingDays,
      dpd,
      target_dpd: target,
      dpd_eff: null,
      tgt_eff: dpd === null || target <= 0 ? null : (dpd / target) * 100,
      working_hours: 0,
      delivery_minutes: entry.minutes,
      delivery_count: entry.timed,
      utr: null,
      avg_delivery_min: null,
      store_dpd: null,
      veh_zone_dpd: null,
      benchmark_mode: partner.benchmark,
    });
  }

  const matches = (driver: Dict): boolean => {
    if (args.zoneIds && !args.zoneIds.includes(String(driver.zone_id ?? ""))) return false;
    if (args.partnerIds) {
      const partner = resolvePartner(driver);
      const candidates = new Set([String(driver.partner_id ?? ""), partner.id ?? ""]);
      if (!Array.from(candidates).some((id) => args.partnerIds?.includes(id))) return false;
    }
    if (args.nationalities && !args.nationalities.includes(String(driver.nationality ?? ""))) return false;
    if (args.driverStatuses && !args.driverStatuses.includes(String(driver.status ?? ""))) return false;
    if (args.vehicleKeys) {
      const key = resolveVehicleKey(driver) ?? "—";
      if (!args.vehicleKeys.includes(key)) return false;
    }
    if (args.companyIds && !args.companyIds.includes(String(driver.source_company ?? ""))) return false;
    if (args.projectKeys) {
      const partner = resolvePartner(driver);
      const wanted = new Set(args.projectKeys.map((key) => key.toLowerCase()));
      const candidates = [partner.key, text(driver, "project_key"), partner.label]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.toLowerCase());
      if (!candidates.some((value) => wanted.has(value))) return false;
    }
    if (args.outsourceOnly) {
      if (text(driver, "source_type") !== "outsourced") return false;
    } else if (args.sourceTypes && !args.sourceTypes.includes(String(driver.source_type ?? ""))) {
      return false;
    }
    if (args.restaurantIds) {
      const assigned = new Set<string>();
      const own = parseId(driver.restaurant_id);
      if (own) assigned.add(own);
      const row = riders.find((item) => item.driver_id === driver.id);
      if (row?.restaurant_id) assigned.add(row.restaurant_id);
      if (!Array.from(assigned).some((id) => args.restaurantIds?.includes(id))) return false;
    }
    return true;
  };

  const logs: AttendanceLogInput[] = [];
  for (const doc of attendanceSnaps.docs) {
    const log = doc.data() as Dict;
    const driverId = parseId(log.driver_id);
    if (!driverId) continue;
    const stamped = asDate(log.log_date);
    const day = text(log, "log_date") ?? (stamped ? kuwaitDayString(stamped) : null);
    if (!day) continue;
    logs.push({
      driverId,
      day,
      checkIn: asDate(log.check_in_at),
      checkOut: asDate(log.check_out_at),
    });
  }
  const shifts: ShiftSessionInput[] = [];
  for (const doc of shiftSnaps.docs) {
    const row = doc.data() as Dict;
    const driverId = parseId(row.driver_id);
    const day = text(row, "shift_date");
    if (!driverId || !day) continue;
    shifts.push({
      id: doc.id,
      driverId,
      day,
      isOff: row.is_off === true,
      shiftType: text(row, "shift_type") ?? "",
      session1Start: text(row, "session1_start"),
      session1End: text(row, "session1_end"),
      session1EndDayOffset: num(row.session1_end_day_offset) ?? 0,
      session2Start: text(row, "session2_start"),
      session2End: text(row, "session2_end"),
      session2StartDayOffset: num(row.session2_start_day_offset) ?? 0,
      session2EndDayOffset: num(row.session2_end_day_offset) ?? 0,
    });
  }
  const allHours = onShiftHoursByDriver({ logs, shifts, now: new Date() });
  const hoursByDriver = new Map<string, number>();
  const hoursByDay = new Map<string, number>();
  for (const [driverId, hours] of allHours.hoursByDriver) {
    const driver = driverById.get(driverId);
    if (!driver || !matches(driver)) continue;
    if (hours <= 0) continue;
    hoursByDriver.set(driverId, hours);
  }
  for (const [key, hours] of allHours.hoursByDriverDay) {
    const sep = key.indexOf("\t");
    const driverId = key.slice(0, sep);
    const day = key.slice(sep + 1);
    const driver = driverById.get(driverId);
    if (!driver || !matches(driver)) continue;
    if (hours <= 0) continue;
    hoursByDay.set(day, (hoursByDay.get(day) ?? 0) + hours);
  }
  let workingHours = 0;
  for (const hours of hoursByDriver.values()) workingHours += hours;
  for (const row of riders) row.working_hours = hoursByDriver.get(row.driver_id) ?? 0;

  const scoped = riders.filter((row) => {
    const driver = driverById.get(row.driver_id) ?? {};
    return matches(driver);
  });

  const storeAgg = new Map<string, Dict>();
  const zoneAgg = new Map<string, Dict>();
  const zoneRest = new Map<string, Dict>();
  const zoneVehicle = new Map<string, { orders: number; days: number }>();
  for (const row of scoped) {
    const storeKey = row.restaurant_id ?? "—";
    const store = storeAgg.get(storeKey) ?? {
      store_id: row.restaurant_id,
      store_name: row.store_name ?? "—",
      zone_id: null,
      zone_name: null,
      zone_best: -1,
      orders: 0,
      working_days: 0,
      riders: 0,
      active_riders: 0,
      working_hours: 0,
      delivery_minutes: 0,
      delivery_count: 0,
      score_sum: 0,
      score_n: 0,
    };
    store.orders = (store.orders as number) + row.orders;
    store.working_days = (store.working_days as number) + row.working_days;
    store.riders = (store.riders as number) + 1;
    store.working_hours = (store.working_hours as number) + row.working_hours;
    store.delivery_minutes = (store.delivery_minutes as number) + row.delivery_minutes;
    store.delivery_count = (store.delivery_count as number) + row.delivery_count;
    if (row.working_days > 0) store.active_riders = (store.active_riders as number) + 1;
    if (row.orders > (store.zone_best as number)) {
      store.zone_best = row.orders;
      store.zone_id = row.zone_id;
      store.zone_name = row.zone_name ?? "—";
    }
    if (row.tgt_eff !== null) {
      store.score_sum = (store.score_sum as number) + row.tgt_eff;
      store.score_n = (store.score_n as number) + 1;
    }
    storeAgg.set(storeKey, store);

    const zvKey = `${row.zone_id ?? "—"}|${row.vehicle_key ?? "—"}`;
    const zv = zoneVehicle.get(zvKey) ?? { orders: 0, days: 0 };
    zv.orders += row.orders;
    zv.days += row.working_days;
    zoneVehicle.set(zvKey, zv);

    const zoneKey = row.zone_id ?? "—";
    const zoneEntry = zoneAgg.get(zoneKey) ?? {
      key: row.zone_id,
      zone_name: row.zone_name ?? "—",
      orders: 0,
      working_days: 0,
      riders: 0,
      working_hours: 0,
      delivery_minutes: 0,
      delivery_count: 0,
      dpd: null,
      score_sum: 0,
      score_n: 0,
    };
    zoneEntry.orders = (zoneEntry.orders as number) + row.orders;
    zoneEntry.working_days = (zoneEntry.working_days as number) + row.working_days;
    zoneEntry.riders = (zoneEntry.riders as number) + 1;
    zoneEntry.working_hours = (zoneEntry.working_hours as number) + row.working_hours;
    zoneEntry.delivery_minutes = (zoneEntry.delivery_minutes as number) + row.delivery_minutes;
    zoneEntry.delivery_count = (zoneEntry.delivery_count as number) + row.delivery_count;
    if (row.tgt_eff !== null) {
      zoneEntry.score_sum = (zoneEntry.score_sum as number) + row.tgt_eff;
      zoneEntry.score_n = (zoneEntry.score_n as number) + 1;
    }
    zoneAgg.set(zoneKey, zoneEntry);

    const comboKey = `${zoneKey}|${storeKey}`;
    const combo = zoneRest.get(comboKey) ?? {
      zone_id: row.zone_id,
      zone_name: row.zone_name ?? "—",
      store_id: row.restaurant_id,
      store_name: row.store_name ?? "—",
      orders: 0,
      working_days: 0,
      riders: 0,
    };
    combo.orders = (combo.orders as number) + row.orders;
    combo.working_days = (combo.working_days as number) + row.working_days;
    combo.riders = (combo.riders as number) + 1;
    zoneRest.set(comboKey, combo);
  }

  for (const row of scoped) {
    row.store_dpd = storeDpd.get(row.restaurant_id ?? "—") ?? null;
    row.veh_zone_dpd = zoneVehicleDpd.get(`${row.zone_id ?? "—"}|${row.vehicle_key ?? "—"}`) ?? null;
    const benchmark = row.benchmark_mode === "zone_vehicle" ? row.veh_zone_dpd : row.store_dpd;
    const ratio = positiveRatio(row.dpd ?? Number.NaN, benchmark ?? Number.NaN);
    row.dpd_eff = ratio === null ? null : ratio * 100;
    row.utr = positiveRatio(row.orders, row.working_hours);
    row.avg_delivery_min = positiveRatio(row.delivery_minutes, row.delivery_count);
  }

  const finalize = (row: Dict): Dict => {
    const days = row.working_days as number;
    const orders = row.orders as number;
    const dpd = days > 0 ? orders / days : null;
    const hours = (row.working_hours as number) ?? 0;
    const minutes = (row.delivery_minutes as number) ?? 0;
    const timed = (row.delivery_count as number) ?? 0;
    return {
      ...row,
      dpd,
      store_dpd: dpd,
      utr: positiveRatio(orders, hours),
      avg_delivery_min: positiveRatio(minutes, timed),
      score: (row.score_n as number) > 0 ? (row.score_sum as number) / (row.score_n as number) : null,
      score_sum: undefined,
      score_n: undefined,
      zone_best: undefined,
    };
  };

  const scopedIds = new Set(scoped.map((row) => row.driver_id));
  const scopedDeliveries = deliveryRows.filter((row) => {
    const driverId = parseId(row.driver_id);
    return driverId !== null && scopedIds.has(driverId);
  });

  return {
    riders: scoped,
    stores: Array.from(storeAgg.values()).map(finalize),
    zones: Array.from(zoneAgg.values()).map(finalize),
    zoneRestaurants: Array.from(zoneRest.values()).map(finalize),
    deliveries: scopedDeliveries,
    driverById,
    zoneById,
    partnerById,
    restaurantById,
    nationalities: Array.from(
      new Set(
        Array.from(driverById.values())
          .map((row) => row.nationality)
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      ),
    ).sort(),
    targetDpd,
    workingHours,
    hoursByDay,
  };
}

export const adminDpdEfficiencySnapshot = onCall(async (request) => {
  await requireStaff(request);

  const data = (request.data ?? {}) as Dict;
  const from = requireDay(data.from, "from");
  const to = requireDay(data.to, "to");
  if (dayDiff(from, to) < 0) throw new HttpsError("invalid-argument", "invalid_date_range");
  if (dayDiff(from, to) + 1 > RANGE_CAP_DAYS) {
    throw new HttpsError("invalid-argument", "range_too_large");
  }

  const roll = await buildRoll(readOpsArgs({ ...data, from, to }));
  await overlayZoneMonthDocs(getFirestore(), from, to, roll.zones);
  return {
    from,
    to,
    riders: roll.riders,
    restaurants: roll.stores,
    zones: roll.zones,
    zone_restaurants: roll.zoneRestaurants,
  };
});

function bucketKey(day: string, bucket: "day" | "week" | "month"): string {
  if (bucket === "month") return day.slice(0, 7);
  if (bucket === "week") {
    return addDays(day, -((kuwaitDayStart(day).getUTCDay() + 1) % 7));
  }
  return day;
}

export const adminPerformanceOpsSnapshot = measureOnCall("adminPerformanceOpsSnapshot", async (request) => {
  await requireStaff(request);

  const data = (request.data ?? {}) as Dict;
  const args = readOpsArgs(data);
  const roll = await buildRoll(args);

  const sumOrders = (rows: Array<{ orders: number }>) => rows.reduce((sum, row) => sum + row.orders, 0);
  const sumDays = (rows: Array<{ working_days: number }>) =>
    rows.reduce((sum, row) => sum + row.working_days, 0);

  const curOrders = sumOrders(roll.riders);
  const curDays = sumDays(roll.riders);
  const overallDpd = curDays > 0 ? curOrders / curDays : null;

  const effRows = roll.riders.filter((row) => row.dpd_eff !== null);
  const tgtRows = roll.riders.filter((row) => row.tgt_eff !== null);
  const avg = (rows: RiderRoll[], pick: (row: RiderRoll) => number | null): number | null => {
    const values = rows.map(pick).filter((value): value is number => value !== null);
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  const storesAbove = roll.stores.filter((store) => {
    const score = store.score as number | null;
    return score !== null && score >= 100;
  }).length;
  const storesBelow = roll.stores.length - storesAbove;

  const bucketAgg = new Map<
    string,
    { orders: number; days: Set<string>; minutes: number; timed: number; hours: number }
  >();
  for (const row of roll.deliveries) {
    const driverId = parseId(row.driver_id);
    const day = typeof row.day === "string" ? row.day : null;
    if (!driverId || !day) continue;
    const key = bucketKey(day, args.bucket);
    const entry = bucketAgg.get(key) ?? {
      orders: 0,
      days: new Set<string>(),
      minutes: 0,
      timed: 0,
      hours: 0,
    };
    entry.orders += 1;
    entry.days.add(`${driverId}|${day}`);
    const minutes = num(row.minutes);
    if (minutes !== null && minutes > 0) {
      entry.minutes += minutes;
      entry.timed += 1;
    }
    bucketAgg.set(key, entry);
  }
  for (const [day, hours] of roll.hoursByDay) {
    const entry = bucketAgg.get(bucketKey(day, args.bucket));
    if (!entry || hours <= 0) continue;
    entry.hours += hours;
  }

  const trend = Array.from(bucketAgg.entries())
    .map(([bucket, entry]) => {
      const workingDays = entry.days.size;
      const dpd = workingDays > 0 ? entry.orders / workingDays : null;
      return {
        bucket,
        orders: entry.orders,
        working_days: workingDays,
        working_hours: entry.hours,
        dpd,
        utr: positiveRatio(entry.orders, entry.hours),
        avg_delivery_min: positiveRatio(entry.minutes, entry.timed),
        delivery_minutes: entry.minutes,
        delivery_count: entry.timed,
        dpd_eff:
          dpd !== null && overallDpd !== null && overallDpd > 0
            ? (dpd / overallDpd) * (avg(effRows, (row) => row.dpd_eff) ?? 0)
            : null,
        tgt_eff:
          dpd !== null && roll.targetDpd > 0 ? (dpd / roll.targetDpd) * 100 : null,
      };
    })
    .sort((a, b) => a.bucket.localeCompare(b.bucket));

  const dims = (bucketId: string | null, label: string | null, rows: RiderRoll[]): Dict => {
    const orders = sumOrders(rows);
    const days = sumDays(rows);
    const hours = rows.reduce((sum, row) => sum + row.working_hours, 0);
    const minutes = rows.reduce((sum, row) => sum + row.delivery_minutes, 0);
    const timed = rows.reduce((sum, row) => sum + row.delivery_count, 0);
    return {
      key: bucketId,
      label,
      orders,
      working_days: days,
      working_hours: hours,
      riders: rows.length,
      dpd: days > 0 ? orders / days : null,
      utr: positiveRatio(orders, hours),
      avg_delivery_min: positiveRatio(minutes, timed),
      dpd_eff: avg(rows, (row) => row.dpd_eff),
      tgt_eff: avg(rows, (row) => row.tgt_eff),
    };
  };

  const byVehicle = (): Dict[] => {
    const map = new Map<string, RiderRoll[]>();
    for (const row of roll.riders) {
      const key = row.vehicle_key ?? "—";
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return Array.from(map.entries())
      .map(([key, rows]) => dims(key === "—" ? null : key, key, rows))
      .sort((a, b) => String(a.key ?? "").localeCompare(String(b.key ?? "")));
  };

  const byKey = (
    pick: (driver: Dict, row: RiderRoll) => { id: string | null; label: string | null },
  ): Dict[] => {
    const map = new Map<string, RiderRoll[]>();
    const labels = new Map<string, string | null>();
    for (const row of roll.riders) {
      const driver = roll.driverById.get(row.driver_id) ?? {};
      const { id, label } = pick(driver, row);
      const key = id ?? "—";
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
      labels.set(key, label);
    }
    return Array.from(map.entries())
      .map(([key, rows]) => dims(key === "—" ? null : key, labels.get(key) ?? null, rows))
      .sort((a, b) => String(a.key ?? "").localeCompare(String(b.key ?? "")));
  };

  const byZone = byKey((_driver, row) => ({ id: row.zone_id, label: row.zone_name }));
  await overlayZoneMonthDocs(getFirestore(), args.from, args.to, byZone);

  return {
    from: args.from,
    to: args.to,
    prev_from: args.prevFrom,
    prev_to: args.prevTo,
    target_dpd: roll.targetDpd,
    partner_mode: args.partnerMode,
    kpis: {
      orders: curOrders,
      orders_prev: null,
      overall_dpd: overallDpd,
      overall_dpd_prev: null,
      avg_dpd_eff: avg(effRows, (row) => row.dpd_eff),
      avg_dpd_eff_prev: null,
      avg_tgt_eff: avg(tgtRows, (row) => row.tgt_eff),
      avg_tgt_eff_prev: null,
      riders: roll.riders.length,
      riders_prev: null,
      active: roll.riders.filter((row) => row.working_days > 0).length,
      active_prev: null,
      working_days: curDays,
      working_hours: roll.workingHours,
      utr: positiveRatio(curOrders, roll.workingHours),
      avg_delivery_min: positiveRatio(
        roll.riders.reduce((sum, row) => sum + row.delivery_minutes, 0),
        roll.riders.reduce((sum, row) => sum + row.delivery_count, 0),
      ),
      stores_above: storesAbove,
      stores_below: storesBelow,
    },
    trend,
    by_vehicle: byVehicle(),
    by_zone: byZone,
    by_partner: byKey((_driver, row) => ({ id: row.partner_id, label: row.partner_label })),
    by_nationality: byKey((driver) => ({
      id: parseId(driver.nationality),
      label: (driver.nationality as string | null) ?? null,
    })),
    by_company: byKey((driver) => ({
      id: parseId(driver.source_company),
      label: (driver.source_company as string | null) ?? null,
    })),
    stores: roll.stores,
    riders: roll.riders
      .map((row) => ({
        driver_id: row.driver_id,
        name: row.driver_name,
        employee_id: row.employee_id,
        driver_code: row.driver_code,
        zone_id: row.zone_id,
        zone: row.zone_name,
        vehicle_key: row.vehicle_key,
        nationality: row.nationality,
        project_key: row.partner_key ?? row.project_key,
        store_id: row.restaurant_id,
        store: row.store_name,
        source_type: row.source_type,
        source_company: row.source_company,
        orders: row.orders,
        working_days: row.working_days,
        working_hours: row.working_hours,
        dpd: row.dpd,
        target_dpd: row.target_dpd,
        store_dpd: row.store_dpd,
        veh_zone_dpd: row.veh_zone_dpd,
        dpd_eff: row.dpd_eff,
        tgt_eff: row.tgt_eff,
        utr: row.utr,
        avg_delivery_min: row.avg_delivery_min,
        delivery_minutes: row.delivery_minutes,
        delivery_count: row.delivery_count,
        status: row.working_days > 0 ? "Active" : "Inactive",
      }))
      .sort((a, b) => b.orders - a.orders || String(a.name ?? "").localeCompare(String(b.name ?? ""))),
    options: optionsFromRoll(roll),
  };
});

/** Built from the roll's own lean maps, so a snapshot reads each collection once. */
function optionsFromRoll(roll: {
  zoneById: Map<string, Dict>;
  restaurantById: Map<string, Dict>;
  partnerById: Map<string, Dict>;
  nationalities: string[];
}): Dict {
  return {
    zones: Array.from(roll.zoneById.values())
      .map((zone) => ({ id: zone.id, name: (zone.name as string | null) ?? null }))
      .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""))),
    restaurants: Array.from(roll.restaurantById.values())
      .filter((restaurant) => restaurant.is_active === true)
      .map((restaurant) => ({ id: restaurant.id, name: (restaurant.name as string | null) ?? null }))
      .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""))),
    nationalities: roll.nationalities,
    partners: Array.from(roll.partnerById.values())
      .map((partner) => ({
        id: partner.id,
        key: text(partner, "key") ?? text(partner, "slug") ?? "",
        name: text(partner, "name"),
        logo_url: text(partner, "logo_url"),
      }))
      .sort((a, b) => String(a.name ?? a.key ?? "").localeCompare(String(b.name ?? b.key ?? ""))),
  };
}

/** Exported so the performance file reuses the same target resolver. */
export { driverDailyDpdState, shiftEndAt, PERFORMANCE_TARGET_DPD, DRIVER_DPD_SHIFT_NOTICES };
export type { DailyDpdState };
