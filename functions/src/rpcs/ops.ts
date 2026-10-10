import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getFirestore, type Query } from "../core/fs";
import { COLLECTIONS, FIELDS } from "../core/collections";
import { kuwaitDayEnd, kuwaitDayRange, kuwaitDayStart, kuwaitDayString } from "../core/kuwait";
import { parseId, parseIdList } from "../core/query";
import { requireStaff } from "../core/staff";
import { overlayZoneMonthDocs } from "../core/rollups";
import { EMPTY_ROW, asDate, loadAllDocs, loadDocMap, num, toRow, type Row } from "./fleet";

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
  await requireStaff(request);

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
  orders: number;
  working_days: number;
  dpd: number | null;
  target_dpd: number | null;
  dpd_eff: number | null;
  tgt_eff: number | null;
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
  bucket: "day" | "week" | "month";
};

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
    companyIds: parseIdList(data.companyIds),
    driverStatuses: parseIdList(data.driverStatuses),
    partnerMode: typeof data.partnerMode === "string" ? data.partnerMode : "all",
    prevFrom: optionalDay(data.prevFrom, "prev_from"),
    prevTo: optionalDay(data.prevTo, "prev_to"),
    bucket,
  };
}

/**
 * The Orders/DPD roll shared by both snapshot RPCs.
 *
 * Orders are verified deliveries on the Kuwait calendar day of `delivered_at`
 * (`delivered_day` is never populated, so it cannot be queried). Working day = a day with at least one verified
 * order. Vehicle comes from `vehicles.vehicle_type_key` through the assignment
 * only; a rider with no vehicle reads as `—`, never Bike.
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
  targetDpd: number;
}> {
  const db = getFirestore();
  const [driverSnaps, deliverySnaps, ruleSnaps, scopeSnaps, vehicleDocs, restaurantDocs, zoneDocs, partnerDocs, targetSnaps] =
    await Promise.all([
      db.collection(COLLECTIONS.drivers).where("archived_at", "==", null).get(),
      db
        .collection(COLLECTIONS.deliveries)
        .where(FIELDS.deliveries.deliveredAt, ">=", kuwaitDayStart(args.from))
        .where(FIELDS.deliveries.deliveredAt, "<", kuwaitDayEnd(args.to))
        .get(),
      db.collection(COLLECTIONS.deliveryRules).get(),
      db.collection(COLLECTIONS.deliveryRuleScopes).get(),
      loadAllDocs(COLLECTIONS.vehicles),
      loadAllDocs(COLLECTIONS.restaurants),
      loadAllDocs(COLLECTIONS.zones),
      loadAllDocs(COLLECTIONS.partners),
      db.collection(PERFORMANCE_TARGET_DPD).get(),
    ]);

  const vehicleById = dictMap(vehicleDocs);
  const restaurantById = dictMap(restaurantDocs);
  const zoneById = dictMap(zoneDocs);
  const partnerById = dictMap(partnerDocs);

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

  const expected = new Set<string>();
  for (const doc of deliverySnaps.docs) {
    const row = doc.data() as Dict;
    if (row.status !== "verified") continue;
    const driverId = parseId(row.driver_id);
    if (!driverId) continue;
    expected.add(driverId);
  }

  const perDriver = new Map<
    string,
    { orders: number; days: Set<string>; restaurantId: string | null; storeName: string | null }
  >();
  for (const doc of deliverySnaps.docs) {
    const row = doc.data() as Dict;
    if (row.status !== "verified") continue;
    const driverId = parseId(row.driver_id);
    if (!driverId) continue;
    const entry =
      perDriver.get(driverId) ?? { orders: 0, days: new Set<string>(), restaurantId: null, storeName: null };
    entry.orders += 1;
    const deliveredAt = asDate(row.delivered_at);
    const day = deliveredAt ? kuwaitDayString(deliveredAt) : null;
    if (day) entry.days.add(day);
    const restaurantId = parseId(row.restaurant_id);
    if (restaurantId) {
      entry.restaurantId = restaurantId;
      entry.storeName = (restaurantById.get(restaurantId)?.name as string | null) ?? null;
    }
    perDriver.set(driverId, entry);
  }

  const riders: RiderRoll[] = [];
  for (const driverId of expected) {
    const driver = driverById.get(driverId);
    if (!driver) continue;
    const entry = perDriver.get(driverId);
    if (!entry) continue;
    const zoneId = parseId(driver.zone_id);
    const restaurantId = entry.restaurantId ?? parseId(driver.restaurant_id);
    const zone = zoneId ? zoneById.get(zoneId) : undefined;
    const zoneName = zone ? ((zone.name as string | null) ?? null) : null;
    const target =
      (restaurantId ? restaurantRuleTarget.get(restaurantId) : undefined) ??
      (zoneId ? zoneRuleTarget.get(zoneId) : undefined) ??
      targetDpd;
    const workingDays = entry.days.size;
    const dpd = workingDays > 0 ? entry.orders / workingDays : null;
    riders.push({
      driver_id: driverId,
      driver_name: (driver.name as string | null) ?? null,
      driver_code: (driver.driver_code as string | null) ?? null,
      employee_id: (driver.employee_id as string | null) ?? null,
      zone_id: zoneId,
      zone_name: zoneName,
      restaurant_id: restaurantId,
      store_name: entry.storeName,
      orders: entry.orders,
      working_days: workingDays,
      dpd,
      target_dpd: target,
      dpd_eff: dpd === null || targetDpd <= 0 ? null : (dpd / targetDpd) * 100,
      tgt_eff: dpd === null || target <= 0 ? null : (dpd / target) * 100,
    });
  }

  const matches = (driver: Dict): boolean => {
    if (args.zoneIds && !args.zoneIds.includes(String(driver.zone_id ?? ""))) return false;
    if (args.partnerIds && !args.partnerIds.includes(String(driver.partner_id ?? ""))) return false;
    if (args.nationalities && !args.nationalities.includes(String(driver.nationality ?? ""))) return false;
    if (args.driverStatuses && !args.driverStatuses.includes(String(driver.status ?? ""))) return false;
    if (args.vehicleKeys) {
      const vehicle = driver.vehicle_id ? vehicleById.get(String(driver.vehicle_id)) : undefined;
      const key = (vehicle?.vehicle_type_key as string | null) ?? "—";
      if (!args.vehicleKeys.includes(key)) return false;
    }
    if (args.companyIds && !args.companyIds.includes(String(driver.source_company ?? ""))) return false;
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

  const scoped = riders.filter((row) => {
    const driver = driverById.get(row.driver_id) ?? {};
    return matches(driver);
  });

  const storeAgg = new Map<string, Dict>();
  const zoneAgg = new Map<string, Dict>();
  const zoneRest = new Map<string, Dict>();
  for (const row of scoped) {
    const storeKey = row.restaurant_id ?? "—";
    const store = storeAgg.get(storeKey) ?? {
      store_id: row.restaurant_id,
      store_name: row.store_name ?? "—",
      orders: 0,
      working_days: 0,
      riders: 0,
      score_sum: 0,
      score_n: 0,
    };
    store.orders = (store.orders as number) + row.orders;
    store.working_days = (store.working_days as number) + row.working_days;
    store.riders = (store.riders as number) + 1;
    if (row.tgt_eff !== null) {
      store.score_sum = (store.score_sum as number) + row.tgt_eff;
      store.score_n = (store.score_n as number) + 1;
    }
    storeAgg.set(storeKey, store);

    const zoneKey = row.zone_id ?? "—";
    const zoneEntry = zoneAgg.get(zoneKey) ?? {
      key: row.zone_id,
      zone_name: row.zone_name ?? "—",
      orders: 0,
      working_days: 0,
      riders: 0,
      dpd: null,
      score_sum: 0,
      score_n: 0,
    };
    zoneEntry.orders = (zoneEntry.orders as number) + row.orders;
    zoneEntry.working_days = (zoneEntry.working_days as number) + row.working_days;
    zoneEntry.riders = (zoneEntry.riders as number) + 1;
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

  const finalize = (row: Dict): Dict => ({
    ...row,
    dpd:
      (row.working_days as number) > 0
        ? (row.orders as number) / (row.working_days as number)
        : null,
    score:
      (row.score_n as number) > 0 ? (row.score_sum as number) / (row.score_n as number) : null,
    score_sum: undefined,
    score_n: undefined,
  });

  const scopedIds = new Set(scoped.map((row) => row.driver_id));
  const scopedDeliveries = deliverySnaps.docs
    .map((doc) => doc.data() as Dict)
    .filter((row) => {
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
    targetDpd,
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

export const adminPerformanceOpsSnapshot = onCall(async (request) => {
  await requireStaff(request);

  const data = (request.data ?? {}) as Dict;
  const args = readOpsArgs(data);
  const roll = await buildRoll(args);

  const days = kuwaitDayRange(args.from, args.to);
  const prevDays =
    args.prevFrom && args.prevTo ? kuwaitDayRange(args.prevFrom, args.prevTo) : [];

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

  const bucketAgg = new Map<string, { orders: number; working_days: number }>();
  const dayOf = new Map<string, string>();
  for (const row of roll.riders) {
    for (const day of days) dayOf.set(row.driver_id, day);
  }
  for (const row of roll.deliveries) {
    if (row.status !== "verified") continue;
    const deliveredAt = asDate(row.delivered_at);
    const day = deliveredAt ? kuwaitDayString(deliveredAt) : null;
    if (!day) continue;
    const key = bucketKey(day, args.bucket);
    const entry = bucketAgg.get(key) ?? { orders: 0, working_days: 0 };
    entry.orders += 1;
    entry.working_days += 1;
    bucketAgg.set(key, entry);
  }

  const trend = Array.from(bucketAgg.entries())
    .map(([bucket, entry]) => {
      const dpd = entry.working_days > 0 ? entry.orders / entry.working_days : null;
      return {
        bucket,
        orders: entry.orders,
        working_days: entry.working_days,
        dpd,
        dpd_eff:
          dpd !== null && overallDpd !== null && overallDpd > 0
            ? (dpd / overallDpd) * (avg(effRows, (row) => row.dpd_eff) ?? 0)
            : null,
        tgt_eff:
          dpd !== null && roll.targetDpd > 0 ? (dpd / roll.targetDpd) * 100 : null,
      };
    })
    .sort((a, b) => a.bucket.localeCompare(b.bucket));

  const dims = (bucketId: string | null, label: string | null, rows: RiderRoll[]): Dict => ({
    key: bucketId,
    label,
    orders: sumOrders(rows),
    working_days: sumDays(rows),
    riders: rows.length,
    dpd: sumDays(rows) > 0 ? sumOrders(rows) / sumDays(rows) : null,
    dpd_eff: avg(rows, (row) => row.dpd_eff),
    tgt_eff: avg(rows, (row) => row.tgt_eff),
  });

  const byVehicle = (): Dict[] => {
    const map = new Map<string, RiderRoll[]>();
    for (const row of roll.riders) {
      const driver = roll.driverById.get(row.driver_id) ?? {};
      const vehicle = driver.vehicle_id
        ? roll.driverById.get(String(driver.vehicle_id))
        : undefined;
      void vehicle;
      const key = (driver.vehicle_type_key as string | null) ?? "—";
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return Array.from(map.entries())
      .map(([key, rows]) => dims(key === "—" ? null : key, key, rows))
      .sort((a, b) => String(a.key ?? "").localeCompare(String(b.key ?? "")));
  };

  const byKey = (pick: (driver: Dict) => { id: string | null; label: string | null }): Dict[] => {
    const map = new Map<string, RiderRoll[]>();
    const labels = new Map<string, string | null>();
    for (const row of roll.riders) {
      const driver = roll.driverById.get(row.driver_id) ?? {};
      const { id, label } = pick(driver);
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

  const byZone = byKey((driver) => {
    const id = parseId(driver.zone_id);
    const name = id ? roll.zoneById.get(id)?.name : undefined;
    return { id, label: (name as string | null) ?? ((driver.zone_name as string | null) ?? null) };
  });
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
      stores_above: storesAbove,
      stores_below: storesBelow,
    },
    trend,
    by_vehicle: byVehicle(),
    by_zone: byZone,
    by_partner: byKey((driver) => {
      const id = parseId(driver.partner_id);
      const name = id ? roll.partnerById.get(id)?.name : undefined;
      return { id, label: (name as string | null) ?? ((driver.partner_name as string | null) ?? null) };
    }),
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
        vehicle_key: null,
        nationality: null,
        project_key: null,
        store_id: row.restaurant_id,
        store: row.store_name,
        source_type: null,
        source_company: null,
        orders: row.orders,
        working_days: row.working_days,
        dpd: row.dpd,
        target_dpd: row.target_dpd,
        store_dpd: null,
        veh_zone_dpd: null,
        dpd_eff: row.dpd_eff,
        tgt_eff: row.tgt_eff,
        status: row.working_days > 0 ? "Active" : "Inactive",
      }))
      .sort((a, b) => b.orders - a.orders || String(a.name ?? "").localeCompare(String(b.name ?? ""))),
    options: await snapshotOptions(days, prevDays),
  };
});

async function snapshotOptions(days: string[], prevDays: string[]): Promise<Dict> {
  const [zoneDocs, restaurantDocs, driverSnaps] = await Promise.all([
    loadAllDocs(COLLECTIONS.zones),
    loadAllDocs(COLLECTIONS.restaurants),
    getFirestore().collection(COLLECTIONS.drivers).where("archived_at", "==", null).get(),
  ]);
  void days;
  void prevDays;

  const nationalities = new Set<string>();
  for (const doc of driverSnaps.docs) {
    const value = (doc.data() as Dict).nationality;
    if (typeof value === "string" && value.length) nationalities.add(value);
  }

  return {
    zones: zoneDocs
      .map((zone) => ({ id: zone.id, name: (zone.name as string | null) ?? null }))
      .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""))),
    restaurants: restaurantDocs
      .filter((restaurant) => restaurant.is_active === true)
      .map((restaurant) => ({ id: restaurant.id, name: (restaurant.name as string | null) ?? null }))
      .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""))),
    nationalities: Array.from(nationalities).sort(),
  };
}

/** Exported so the performance file reuses the same target resolver. */
export { driverDailyDpdState, shiftEndAt, PERFORMANCE_TARGET_DPD, DRIVER_DPD_SHIFT_NOTICES };
export type { DailyDpdState };
