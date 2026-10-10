import { onCall } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { kuwaitDayString, kuwaitDayStart } from "../core/kuwait";
import { kuwaitWeekStart } from "../core/money";
import { loadAppSettings } from "../core/settings";
import { requireRider, riderError } from "../core/rider";
import { applyAttendanceRollup } from "../core/rollups";
import { computeIncentiveAmount, type IncentiveRule, type IncentiveTier } from "../core/incentive";
import { driverRestaurantIds } from "./deliveries-shared";
import {
  isoTimestamp,
  logDriverOperation,
  numberOrNull,
  pickBoolean,
  pickTriBool,
  type Dict,
} from "./_shared";
import {
  findActiveShift,
  parseShiftTime,
  shiftSessionInstant,
  type ShiftRow,
} from "./driver-shift";

const DRIVER_ATTENDANCE = "driver_attendance";
const HOME_BANNERS = "home_banners";
const DRIVER_HOME_BANNERS = "driver_home_banners";
const DRIVER_GROUP_MEMBERS = "driver_group_members";
const WEEK_PROGRESS_STATUSES = new Set(["in_transit", "pending", "under_review", "verified"]);
const SCAN = 2_000;

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

function asBool(value: unknown): boolean {
  return value === true;
}

async function assignedRestaurantIds(driverId: string, driver: Dict): Promise<string[]> {
  const ids = new Set(driverRestaurantIds(driver));
  const snap = await getFirestore()
    .collection(COLLECTIONS.driverRestaurants)
    .where("driver_id", "==", driverId)
    .limit(SCAN)
    .get();
  for (const doc of snap.docs) {
    const restaurantId = asString((doc.data() ?? {})["restaurant_id"]);
    if (restaurantId) ids.add(restaurantId);
  }
  return [...ids];
}

async function loadSourceCompany(key: string | null): Promise<Dict | null> {
  if (!key) return null;
  const db = getFirestore();
  const byId = await db.collection(COLLECTIONS.sourceCompanies).doc(key).get();
  if (byId.exists) return (byId.data() ?? {}) as Dict;
  const snap = await db
    .collection(COLLECTIONS.sourceCompanies)
    .where("key", "==", key)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return (snap.docs[0].data() ?? {}) as Dict;
}

/**
 * User-plan hide: enabled company scheme that is not system `mg`.
 * SQL `company_config_applies` additionally requires outsourced + effective_from.
 */
async function companyHidesWeeklyIncentive(driver: Dict): Promise<boolean> {
  const key = asString(driver["source_company"]);
  if (!key || key === "mg") return false;
  const company = await loadSourceCompany(key);
  if (!company) return false;
  if (company["is_system"] === true) return false;
  return company["incentive_enabled"] === true;
}

function ruleMatchesDriver(args: {
  scopeType: string;
  scopes: Array<{ zone_id: string | null; partner_id: string | null; restaurant_id: string | null }>;
  zoneId: string | null;
  partnerId: string | null;
  restaurantIds: readonly string[];
}): boolean {
  const { scopeType, scopes, zoneId, partnerId, restaurantIds } = args;
  if (scopeType === "zone") {
    return scopes.some((scope) => scope.zone_id !== null && scope.zone_id === zoneId);
  }
  if (scopeType === "partner") {
    return scopes.some((scope) => scope.partner_id !== null && scope.partner_id === partnerId);
  }
  if (scopeType === "restaurant") {
    return scopes.some(
      (scope) => scope.restaurant_id !== null && restaurantIds.includes(scope.restaurant_id),
    );
  }
  return false;
}

async function latestSession(driverId: string): Promise<Dict | null> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.driverSessions)
    .where("driver_id", "==", driverId)
    .limit(SCAN)
    .get();
  let best: Dict | null = null;
  let bestAt = -1;
  for (const doc of snap.docs) {
    const raw = (doc.data() ?? {}) as Dict;
    const at =
      asDate(raw["updated_at"])?.getTime() ??
      asDate(raw["created_at"])?.getTime() ??
      0;
    if (at >= bestAt) {
      bestAt = at;
      best = { id: doc.id, ...raw };
    }
  }
  return best;
}

async function openOnlineSession(driverId: string): Promise<{ id: string; data: Dict } | null> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.driverSessions)
    .where("driver_id", "==", driverId)
    .where("is_online", "==", true)
    .limit(50)
    .get();
  let best: { id: string; data: Dict } | null = null;
  let bestAt = -1;
  for (const doc of snap.docs) {
    const data = (doc.data() ?? {}) as Dict;
    const at = asDate(data["created_at"])?.getTime() ?? asDate(data["went_online_at"])?.getTime() ?? 0;
    if (at >= bestAt) {
      bestAt = at;
      best = { id: doc.id, data };
    }
  }
  return best;
}

async function attendanceLogOn(driverId: string, day: string): Promise<{ id: string; data: Dict } | null> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.attendanceLogs)
    .where("driver_id", "==", driverId)
    .where("log_date", "==", day)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, data: (snap.docs[0].data() ?? {}) as Dict };
}

async function attendanceDayOn(driverId: string, day: string): Promise<{ id: string; data: Dict } | null> {
  const snap = await getFirestore()
    .collection(DRIVER_ATTENDANCE)
    .where("driver_id", "==", driverId)
    .where("attendance_date", "==", day)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, data: (snap.docs[0].data() ?? {}) as Dict };
}

async function locationOf(driverId: string): Promise<Dict> {
  const db = getFirestore();
  const byId = await db.collection(COLLECTIONS.driverLocations).doc(driverId).get();
  if (byId.exists) return (byId.data() ?? {}) as Dict;
  const snap = await db
    .collection(COLLECTIONS.driverLocations)
    .where("driver_id", "==", driverId)
    .limit(1)
    .get();
  return snap.empty ? {} : ((snap.docs[0].data() ?? {}) as Dict);
}

async function weekEarnings(driverId: string, weekStart: string, today: string): Promise<number> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.driverWalletEntries)
    .where("driver_id", "==", driverId)
    .where("earn_date", ">=", weekStart)
    .where("earn_date", "<=", today)
    .limit(SCAN)
    .get();
  let sum = 0;
  for (const doc of snap.docs) {
    const raw = (doc.data() ?? {}) as Dict;
    if (raw["status"] !== "approved") continue;
    if (raw["entry_type"] !== "earning_credit") continue;
    sum += numberOrNull(raw["amount_kwd"]) ?? 0;
  }
  return Math.round(sum * 1000) / 1000;
}

function deliveryDay(raw: Dict): string | null {
  const shift = asDay(raw["shift_date"]);
  if (shift) return shift;
  const at = asDate(raw["delivered_at"]) ?? asDate(raw["pickup_at"]);
  return at ? kuwaitDayString(at) : asDay(raw["delivered_day"]) ?? asDay(raw["created_day"]);
}

async function weekDeliveryCount(driverId: string, weekStart: string, today: string): Promise<number> {
  const db = getFirestore();
  const [byShift, byDelivered] = await Promise.all([
    db
      .collection(COLLECTIONS.deliveries)
      .where("driver_id", "==", driverId)
      .where("shift_date", ">=", weekStart)
      .where("shift_date", "<=", today)
      .limit(SCAN)
      .get(),
    db
      .collection(COLLECTIONS.deliveries)
      .where("driver_id", "==", driverId)
      .where("delivered_day", ">=", weekStart)
      .where("delivered_day", "<=", today)
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
      const status = asString(raw["status"]);
      if (!status || !WEEK_PROGRESS_STATUSES.has(status)) continue;
      const day = deliveryDay(raw);
      if (!day || day < weekStart || day > today) continue;
      count += 1;
    }
  }
  return count;
}

async function weekOnlineSeconds(
  driverId: string,
  weekStart: string,
  today: string,
  now: Date,
): Promise<number> {
  const snap = await getFirestore()
    .collection(DRIVER_ATTENDANCE)
    .where("driver_id", "==", driverId)
    .where("attendance_date", ">=", weekStart)
    .where("attendance_date", "<=", today)
    .limit(40)
    .get();
  let seconds = 0;
  for (const doc of snap.docs) {
    seconds += Math.max(0, Math.trunc(numberOrNull((doc.data() ?? {})["online_seconds"]) ?? 0));
  }
  const open = await openOnlineSession(driverId);
  const wentOnline = open ? asDate(open.data["went_online_at"]) : null;
  if (wentOnline && kuwaitDayString(wentOnline) === today) {
    seconds += Math.max(0, Math.floor((now.getTime() - wentOnline.getTime()) / 1000));
  }
  return seconds;
}

async function performanceCounts(driverId: string): Promise<Dict> {
  const col = getFirestore().collection(COLLECTIONS.deliveries).where("driver_id", "==", driverId);
  const [all, cancelled, verified, pending, inTransit, rejected] = await Promise.all([
    col.count().get(),
    col.where("status", "==", "cancelled").count().get(),
    col.where("status", "==", "verified").count().get(),
    col.where("status", "==", "pending").count().get(),
    col.where("status", "==", "in_transit").count().get(),
    col.where("status", "==", "rejected").count().get(),
  ]);
  return {
    total_deliveries: Math.max(0, all.data().count - cancelled.data().count),
    verified_deliveries: verified.data().count,
    pending_deliveries: pending.data().count + inTransit.data().count,
    rejected_deliveries: rejected.data().count,
  };
}

function deliveryRuleSummary(scopeType: string, name: string, restaurantName: string | null): string {
  if (scopeType === "restaurant" && restaurantName) {
    return `Verified deliveries from ${restaurantName} count toward incentives`;
  }
  if (scopeType === "partner") {
    return "Verified deliveries for this partner count toward incentives";
  }
  if (scopeType === "zone") {
    return "Verified deliveries in your zone count toward incentives";
  }
  return name;
}

async function matchingDeliveryRules(args: {
  today: string;
  zoneId: string | null;
  partnerId: string | null;
  restaurantIds: readonly string[];
}): Promise<Dict[]> {
  const db = getFirestore();
  const rulesSnap = await db
    .collection(COLLECTIONS.deliveryRules)
    .where("status", "==", "active")
    .limit(SCAN)
    .get();
  const matched: Array<{ id: string; raw: Dict; priority: number; name: string }> = [];
  for (const doc of rulesSnap.docs) {
    const raw = (doc.data() ?? {}) as Dict;
    const start = asDay(raw["start_date"]) ?? "1970-01-01";
    const end = asDay(raw["end_date"]) ?? "9999-12-31";
    if (args.today < start || args.today > end) continue;
    matched.push({
      id: doc.id,
      raw,
      priority: numberOrNull(raw["priority"]) ?? 0,
      name: asString(raw["name"]) ?? "",
    });
  }
  if (matched.length === 0) return [];

  const scopesSnap = await db.collection(COLLECTIONS.deliveryRuleScopes).limit(SCAN).get();
  const scopesByRule = new Map<
    string,
    Array<{ zone_id: string | null; partner_id: string | null; restaurant_id: string | null }>
  >();
  const restaurantIds = new Set<string>();
  for (const doc of scopesSnap.docs) {
    const raw = (doc.data() ?? {}) as Dict;
    const ruleId = asString(raw["delivery_rule_id"]);
    if (!ruleId) continue;
    const scope = {
      zone_id: asString(raw["zone_id"]),
      partner_id: asString(raw["partner_id"]),
      restaurant_id: asString(raw["restaurant_id"]),
    };
    if (scope.restaurant_id) restaurantIds.add(scope.restaurant_id);
    scopesByRule.set(ruleId, [...(scopesByRule.get(ruleId) ?? []), scope]);
  }

  const restaurantMap = new Map<string, string>();
  if (restaurantIds.size > 0) {
    const snaps = await db.getAll(
      ...[...restaurantIds].slice(0, 300).map((id) => db.collection(COLLECTIONS.restaurants).doc(id)),
    );
    for (const snap of snaps) {
      if (snap.exists) restaurantMap.set(snap.id, asString((snap.data() ?? {})["name"]) ?? "");
    }
  }

  const rows: Array<Dict & { _priority: number; _name: string }> = [];
  for (const rule of matched) {
    const scopeType = asString(rule.raw["scope_type"]) ?? "restaurant";
    const scopes = scopesByRule.get(rule.id) ?? [];
    if (
      !ruleMatchesDriver({
        scopeType,
        scopes,
        zoneId: args.zoneId,
        partnerId: args.partnerId,
        restaurantIds: args.restaurantIds,
      })
    ) {
      continue;
    }
    const restaurantId = scopes.find((scope) => scope.restaurant_id)?.restaurant_id ?? null;
    const restaurantName = restaurantId ? restaurantMap.get(restaurantId) ?? null : null;
    rows.push({
      id: rule.id,
      name: rule.name,
      scope_type: scopeType,
      restaurant_name: restaurantName,
      start_date: asDay(rule.raw["start_date"]),
      end_date: asDay(rule.raw["end_date"]),
      summary: deliveryRuleSummary(scopeType, rule.name, restaurantName),
      _priority: rule.priority,
      _name: rule.name,
    });
  }
  rows.sort((a, b) => b._priority - a._priority || a._name.localeCompare(b._name));
  return rows.map(({ _priority, _name, ...rest }) => {
    void _priority;
    void _name;
    return rest;
  });
}

async function primaryWeeklyIncentive(args: {
  today: string;
  zoneId: string | null;
  partnerId: string | null;
  restaurantIds: readonly string[];
}): Promise<Dict | null> {
  const db = getFirestore();
  const rulesSnap = await db
    .collection(COLLECTIONS.incentiveRules)
    .where("status", "==", "active")
    .where("period", "==", "weekly")
    .limit(SCAN)
    .get();
  const candidates: Array<{
    id: string;
    raw: Dict;
    priority: number;
    createdAt: number;
    scopeType: string;
  }> = [];
  for (const doc of rulesSnap.docs) {
    const raw = (doc.data() ?? {}) as Dict;
    const start = asDay(raw["start_date"]) ?? "1970-01-01";
    const end = asDay(raw["end_date"]) ?? "9999-12-31";
    if (args.today < start || args.today > end) continue;
    candidates.push({
      id: doc.id,
      raw,
      priority: numberOrNull(raw["priority"]) ?? 0,
      createdAt: asDate(raw["created_at"])?.getTime() ?? 0,
      scopeType: asString(raw["scope_type"]) ?? "restaurant",
    });
  }
  if (candidates.length === 0) return null;

  const scopesSnap = await db.collection(COLLECTIONS.incentiveRuleScopes).limit(SCAN).get();
  const scopesByRule = new Map<
    string,
    Array<{ zone_id: string | null; partner_id: string | null; restaurant_id: string | null }>
  >();
  for (const doc of scopesSnap.docs) {
    const raw = (doc.data() ?? {}) as Dict;
    const ruleId = asString(raw["incentive_rule_id"]);
    if (!ruleId) continue;
    scopesByRule.set(ruleId, [
      ...(scopesByRule.get(ruleId) ?? []),
      {
        zone_id: asString(raw["zone_id"]),
        partner_id: asString(raw["partner_id"]),
        restaurant_id: asString(raw["restaurant_id"]),
      },
    ]);
  }

  const matching = candidates.filter((rule) =>
    ruleMatchesDriver({
      scopeType: rule.scopeType,
      scopes: scopesByRule.get(rule.id) ?? [],
      zoneId: args.zoneId,
      partnerId: args.partnerId,
      restaurantIds: args.restaurantIds,
    }),
  );
  matching.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
  const picked = matching[0];
  if (!picked) return null;

  const tiersSnap = await db
    .collection(COLLECTIONS.incentiveRuleTiers)
    .where("incentive_rule_id", "==", picked.id)
    .limit(200)
    .get();
  const tiers: IncentiveTier[] = tiersSnap.docs
    .map((doc) => {
      const raw = (doc.data() ?? {}) as Dict;
      return {
        threshold_deliveries: numberOrNull(raw["threshold_deliveries"]) ?? 0,
        reward_mode: (asString(raw["reward_mode"]) ?? "per_delivery") as IncentiveTier["reward_mode"],
        reward_kwd: numberOrNull(raw["reward_kwd"]),
        reward_per_delivery_kwd: numberOrNull(raw["reward_per_delivery_kwd"]),
      };
    })
    .sort((a, b) => a.threshold_deliveries - b.threshold_deliveries);

  const targetMode = asString(picked.raw["target_mode"]) ?? "single";
  const target =
    targetMode === "tiered"
      ? Math.max(
          ...tiers.map((tier) => tier.threshold_deliveries),
          numberOrNull(picked.raw["base_minimum_deliveries"]) ?? 0,
        )
      : numberOrNull(picked.raw["target_deliveries"]) ?? 0;

  const rule: IncentiveRule = {
    id: picked.id,
    name: asString(picked.raw["name"]) ?? "—",
    period: "weekly",
    status: "active",
    start_date: asDay(picked.raw["start_date"]) ?? args.today,
    end_date: asDay(picked.raw["end_date"]) ?? args.today,
    priority: picked.priority,
    created_at: isoTimestamp(picked.raw["created_at"]) ?? "",
    scope_type: (picked.scopeType === "zone" || picked.scopeType === "partner"
      ? picked.scopeType
      : "restaurant") as IncentiveRule["scope_type"],
    target_mode: targetMode === "tiered" ? "tiered" : "single",
    base_minimum_deliveries: numberOrNull(picked.raw["base_minimum_deliveries"]),
    target_deliveries: numberOrNull(picked.raw["target_deliveries"]),
    reward_mode: (asString(picked.raw["reward_mode"]) ?? "per_delivery") as IncentiveRule["reward_mode"],
    reward_kwd: numberOrNull(picked.raw["reward_kwd"]),
    reward_per_delivery_kwd: numberOrNull(picked.raw["reward_per_delivery_kwd"]),
    payout_mode: (asString(picked.raw["payout_mode"]) ?? "per_tier") as IncentiveRule["payout_mode"],
    overrides_others: picked.raw["overrides_others"] === true,
    zone_id: asString(picked.raw["zone_id"]),
    partner_id: asString(picked.raw["partner_id"]),
    restaurant_id: asString(picked.raw["restaurant_id"]),
  };

  const computed =
    target > 0
      ? computeIncentiveAmount({ rule, tiers, eligibleCount: target, gateTarget: null })
      : 0;
  const reward = numberOrNull(picked.raw["reward_kwd"]) ?? computed;

  return {
    rule_id: picked.id,
    name: rule.name,
    eligible_count: 0,
    progress_count: 0,
    target,
    reward_kwd: reward,
    remaining_deliveries: Math.max(0, target),
    target_mode: targetMode,
    tiers: tiers.map((tier) => ({
      threshold: tier.threshold_deliveries,
      reward_kwd: tier.reward_kwd,
      reward_per_delivery_kwd: tier.reward_per_delivery_kwd,
      reward_mode: tier.reward_mode,
    })),
  };
}

async function shiftOnDate(driverId: string, day: string): Promise<ShiftRow | null> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.driverDailyShifts)
    .where("driver_id", "==", driverId)
    .where("shift_date", "==", day)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const raw = (snap.docs[0].data() ?? {}) as Dict;
  const driver = asString(raw["driver_id"]);
  const shiftDate = asDay(raw["shift_date"]);
  const session1Start = asString(raw["session1_start"]);
  const session1End = asString(raw["session1_end"]);
  if (!driver || !shiftDate || !session1Start || !session1End) return null;
  return {
    id: snap.docs[0].id,
    driver_id: driver,
    shift_date: shiftDate,
    shift_type: raw["shift_type"] === "split" ? "split" : "single",
    session1_start: session1Start,
    session1_end: session1End,
    session1_end_day_offset: numberOrNull(raw["session1_end_day_offset"]) ?? 0,
    session2_start: asString(raw["session2_start"]),
    session2_end: asString(raw["session2_end"]),
    session2_start_day_offset: numberOrNull(raw["session2_start_day_offset"]) ?? 0,
    session2_end_day_offset: numberOrNull(raw["session2_end_day_offset"]) ?? 0,
    submitted_at: raw["submitted_at"] ?? null,
  };
}

async function closedSessionSeconds(driverId: string, day: string): Promise<number> {
  const start = kuwaitDayStart(day);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const snap = await getFirestore()
    .collection(COLLECTIONS.driverSessions)
    .where("driver_id", "==", driverId)
    .where("went_online_at", ">=", Timestamp.fromDate(start))
    .where("went_online_at", "<", Timestamp.fromDate(end))
    .limit(SCAN)
    .get();
  let seconds = 0;
  for (const doc of snap.docs) {
    const raw = (doc.data() ?? {}) as Dict;
    const online = asDate(raw["went_online_at"]);
    const offline = asDate(raw["went_offline_at"]);
    if (!online || !offline) continue;
    seconds += Math.max(0, Math.floor((offline.getTime() - online.getTime()) / 1000));
  }
  return seconds;
}

async function shiftAdherence(driverId: string, today: string): Promise<Dict> {
  const shift = await shiftOnDate(driverId, today);
  if (!shift) return {};

  const s1Start = parseShiftTime(shift.session1_start);
  const s1End = parseShiftTime(shift.session1_end);
  if (!s1Start || !s1End) return {};

  const scheduledStart = shiftSessionInstant(shift.shift_date, s1Start, 0);
  let scheduledEnd = shiftSessionInstant(shift.shift_date, s1End, shift.session1_end_day_offset);
  if (shift.shift_type === "split" && shift.session2_end) {
    const s2End = parseShiftTime(shift.session2_end);
    if (s2End) {
      scheduledEnd = shiftSessionInstant(
        shift.shift_date,
        s2End,
        shift.session2_end_day_offset,
      );
    }
  }

  const [log, dayRow, settings, sessionSeconds] = await Promise.all([
    attendanceLogOn(driverId, today),
    attendanceDayOn(driverId, today),
    loadAppSettings(),
    closedSessionSeconds(driverId, today),
  ]);

  let actualIn = log ? asDate(log.data["check_in_at"]) : null;
  const actualOut = log ? asDate(log.data["check_out_at"]) : null;
  if (!actualIn) actualIn = dayRow ? asDate(dayRow.data["first_online_at"]) : null;

  const storedOnline = dayRow ? Math.trunc(numberOrNull(dayRow.data["online_seconds"]) ?? 0) : 0;
  const onlineSeconds = Math.max(storedOnline, sessionSeconds);
  const scheduledSeconds = Math.max(
    0,
    Math.floor((scheduledEnd.getTime() - scheduledStart.getTime()) / 1000),
  );
  const grace = settings.attendance_late_grace_minutes;

  let minutesLate = 0;
  if (actualIn) {
    minutesLate = Math.max(
      0,
      Math.floor((actualIn.getTime() - scheduledStart.getTime()) / 60_000) - grace,
    );
  }

  let minutesEarlyOut = 0;
  if (actualOut) {
    const clampedOut = actualOut.getTime() < scheduledStart.getTime() ? scheduledStart : actualOut;
    minutesEarlyOut = Math.min(
      Math.max(0, Math.floor((scheduledEnd.getTime() - clampedOut.getTime()) / 60_000)),
      Math.floor(scheduledSeconds / 60),
    );
  }

  return {
    scheduled_start_at: scheduledStart.toISOString(),
    scheduled_end_at: scheduledEnd.toISOString(),
    actual_in_at: actualIn ? actualIn.toISOString() : null,
    actual_out_at: actualOut ? actualOut.toISOString() : null,
    minutes_late: minutesLate,
    minutes_early_out: minutesEarlyOut,
    online_seconds: onlineSeconds,
    scheduled_seconds: scheduledSeconds,
  };
}

function bannerWindowOk(raw: Dict, now: Date): boolean {
  if (raw["is_active"] !== true) return false;
  const starts = asDate(raw["starts_at"]);
  const ends = asDate(raw["ends_at"]);
  if (starts && starts.getTime() > now.getTime()) return false;
  if (ends && ends.getTime() < now.getTime()) return false;
  return true;
}

function listIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

async function loadBanner(driverId: string, zoneId: string | null, partnerId: string | null, now: Date): Promise<Dict | null> {
  const db = getFirestore();
  const [home, driverHome, groups] = await Promise.all([
    db.collection(HOME_BANNERS).limit(200).get().catch(() => null),
    db.collection(DRIVER_HOME_BANNERS).limit(200).get().catch(() => null),
    db
      .collection(DRIVER_GROUP_MEMBERS)
      .where("driver_id", "==", driverId)
      .limit(200)
      .get()
      .catch(() => null),
  ]);
  const memberGroups = new Set<string>();
  if (groups) {
    for (const doc of groups.docs) {
      const groupId = asString((doc.data() ?? {})["group_id"]);
      if (groupId) memberGroups.add(groupId);
    }
  }

  const candidates: Array<{ id: string; raw: Dict; sort: number; created: number }> = [];
  for (const snap of [home, driverHome]) {
    if (!snap) continue;
    for (const doc of snap.docs) {
      const raw = (doc.data() ?? {}) as Dict;
      if (!bannerWindowOk(raw, now)) continue;
      const zones = listIds(raw["zone_ids"]);
      const partners = listIds(raw["partner_ids"]);
      const groupIds = listIds(raw["driver_group_ids"]);
      if (zones.length > 0 && (!zoneId || !zones.includes(zoneId))) continue;
      if (partners.length > 0 && (!partnerId || !partners.includes(partnerId))) continue;
      if (groupIds.length > 0 && !groupIds.some((id) => memberGroups.has(id))) continue;
      candidates.push({
        id: doc.id,
        raw,
        sort: numberOrNull(raw["sort_order"]) ?? 0,
        created: asDate(raw["created_at"])?.getTime() ?? 0,
      });
    }
  }
  candidates.sort((a, b) => a.sort - b.sort || b.created - a.created);
  const first = candidates[0];
  if (!first) return null;
  return {
    id: first.id,
    image_url: asString(first.raw["image_url"]),
    caption_en: asString(first.raw["caption_en"]),
    caption_ar: asString(first.raw["caption_ar"]),
    deep_link: asString(first.raw["deep_link"]),
  };
}

export async function loadRiderHomeDashboard(args: {
  uid: string;
  driver: Dict;
  profile: Dict;
  now?: Date;
}): Promise<Dict> {
  const now = args.now ?? new Date();
  const today = kuwaitDayString(now);
  const weekStart = kuwaitWeekStart(today);
  const zoneId = asString(args.driver["zone_id"]);
  const partnerId = asString(args.driver["partner_id"]);
  const forceAt = args.driver["force_app_update_at"];
  const forceMin = numberOrNull(args.driver["force_app_update_min_code"]);
  const forceAppUpdate = forceAt != null && forceMin !== null;

  const restaurantIds = await assignedRestaurantIds(args.uid, args.driver);
  const hideWeekly = await companyHidesWeeklyIncentive(args.driver);

  const [partnerSnap, session, location, earnings, deliveries, onlineSeconds, performance, adherence] =
    await Promise.all([
      partnerId
        ? getFirestore().collection(COLLECTIONS.partners).doc(partnerId).get()
        : Promise.resolve(null),
      latestSession(args.uid),
      locationOf(args.uid),
      weekEarnings(args.uid, weekStart, today),
      weekDeliveryCount(args.uid, weekStart, today),
      weekOnlineSeconds(args.uid, weekStart, today, now),
      performanceCounts(args.uid),
      shiftAdherence(args.uid, today),
    ]);

  const partner = partnerSnap?.exists ? ((partnerSnap.data() ?? {}) as Dict) : {};
  const [rules, incentive, banner] = await Promise.all([
    matchingDeliveryRules({
      today,
      zoneId,
      partnerId,
      restaurantIds,
    }),
    hideWeekly
      ? Promise.resolve(null)
      : primaryWeeklyIncentive({ today, zoneId, partnerId, restaurantIds }),
    loadBanner(args.uid, zoneId, partnerId, now),
  ]);

  return {
    driver: {
      full_name: asString(args.profile["full_name"]) ?? "Driver",
      is_on_duty: asBool(args.driver["is_on_duty"]),
      partner_name: asString(partner["name"]),
      partner_logo_url: asString(partner["logo_url"]),
    },
    session: {
      is_online: asBool(session?.["is_online"]),
      went_online_at: isoTimestamp(session?.["went_online_at"]),
      speed_mps: numberOrNull(location["speed_mps"]),
      distance_today_meters: numberOrNull(location["distance_today_meters"]) ?? 0,
    },
    week: {
      start_date: weekStart,
      end_date: today,
      earnings_kwd: earnings,
      deliveries_count: deliveries,
      online_seconds: onlineSeconds,
    },
    primary_weekly_incentive: incentive,
    delivery_rules: rules,
    shift_adherence: adherence,
    performance,
    banner,
    force_app_update: forceAppUpdate,
    force_app_update_min_code: forceMin,
  };
}

export async function applyRiderCheckout(args: {
  driverId: string;
  reason: string;
  now: Date;
  keepDutyWrite?: boolean;
}): Promise<void> {
  const db = getFirestore();
  const today = kuwaitDayString(args.now);
  const stamp = Timestamp.fromDate(args.now);
  const [log, open, location] = await Promise.all([
    attendanceLogOn(args.driverId, today),
    openOnlineSession(args.driverId),
    locationOf(args.driverId),
  ]);
  const batch = db.batch();
  if (args.keepDutyWrite !== false) {
    batch.set(
      db.collection(COLLECTIONS.drivers).doc(args.driverId),
      { is_on_duty: false, updated_at: stamp },
      { merge: true },
    );
  }
  if (open) {
    const wentOnline = asDate(open.data["went_online_at"]);
    const elapsed = wentOnline
      ? Math.max(0, Math.floor((args.now.getTime() - wentOnline.getTime()) / 1000))
      : 0;
    batch.set(
      db.collection(COLLECTIONS.driverSessions).doc(open.id),
      {
        is_online: false,
        went_offline_at: open.data["went_offline_at"] ?? stamp,
        updated_at: stamp,
      },
      { merge: true },
    );
    const dayRow = await attendanceDayOn(args.driverId, today);
    if (dayRow && elapsed > 0) {
      const previous = Math.trunc(numberOrNull(dayRow.data["online_seconds"]) ?? 0);
      batch.set(
        db.collection(DRIVER_ATTENDANCE).doc(dayRow.id),
        { online_seconds: previous + elapsed, last_online_at: stamp, updated_at: stamp },
        { merge: true },
      );
    }
  }
  if (log) {
    batch.set(
      db.collection(COLLECTIONS.attendanceLogs).doc(log.id),
      {
        check_out_at: stamp,
        check_out_reason: args.reason,
        updated_at: stamp,
        distance_meters:
          numberOrNull(location["distance_today_meters"]) ?? log.data["distance_meters"] ?? null,
      },
      { merge: true },
    );
  }
  await batch.commit();
}

export const driverGetHomeDashboard = onCall(async (request) => {
  const ctx = await requireRider(request);
  return loadRiderHomeDashboard({
    uid: ctx.uid,
    driver: ctx.driver,
    profile: ctx.profile,
  });
});

export const driverSetDutyState = onCall(async (request) => {
  const ctx = await requireRider(request);
  const data = (request.data ?? {}) as Dict;
  const isOnDuty = pickTriBool(data, "is_on_duty", "p_is_on_duty") ?? pickBoolean(data, "is_on_duty", "p_is_on_duty");
  const isOnline = pickTriBool(data, "is_online", "p_is_online") ?? pickBoolean(data, "is_online", "p_is_online");
  const now = new Date();
  const today = kuwaitDayString(now);
  const stamp = Timestamp.fromDate(now);
  const db = getFirestore();
  const driver = ctx.driver;
  const wasOnDuty = driver["is_on_duty"] === true;
  const archivedAt = driver["archived_at"];
  const status = asString(driver["status"]);

  if (isOnDuty || isOnline) {
    if (archivedAt != null) {
      throw riderError("failed-precondition", "driver_archived");
    }
    if (status !== "active") {
      throw riderError("failed-precondition", "inactive");
    }
    const shift = await findActiveShift(ctx.uid, now);
    if (!shift) {
      throw riderError("failed-precondition", "shift_required");
    }
  }

  await db.collection(COLLECTIONS.drivers).doc(ctx.uid).set(
    { is_on_duty: isOnDuty, updated_at: stamp },
    { merge: true },
  );

  if (isOnDuty) {
    const existing = await attendanceLogOn(ctx.uid, today);
    const payload: Dict = {
      driver_id: ctx.uid,
      log_date: today,
      check_out_at: null,
      check_out_reason: null,
      updated_at: stamp,
    };
    const zoneId = asString(driver["zone_id"]);
    if (existing) {
      const keepLeave = existing.data["status"] === "on_leave";
      await db
        .collection(COLLECTIONS.attendanceLogs)
        .doc(existing.id)
        .set(
          {
            ...payload,
            check_in_at: existing.data["check_in_at"] ?? stamp,
            status: keepLeave ? "on_leave" : "present",
          },
          { merge: true },
        );
      await applyAttendanceRollup(db, {
        driverId: ctx.uid,
        zoneId,
        day: today,
        logId: existing.id,
        present: !keepLeave,
      });
    } else {
      const created = await db.collection(COLLECTIONS.attendanceLogs).add({
        ...payload,
        check_in_at: stamp,
        status: "present",
        created_at: stamp,
      });
      await applyAttendanceRollup(db, {
        driverId: ctx.uid,
        zoneId,
        day: today,
        logId: created.id,
        present: true,
      });
    }
  }

  const open = await openOnlineSession(ctx.uid);
  if (isOnline) {
    if (!open) {
      await db.collection(COLLECTIONS.driverSessions).add({
        driver_id: ctx.uid,
        is_online: true,
        went_online_at: stamp,
        went_offline_at: null,
        created_at: stamp,
        updated_at: stamp,
      });
    } else {
      await db.collection(COLLECTIONS.driverSessions).doc(open.id).set(
        { is_online: true, went_offline_at: null, updated_at: stamp },
        { merge: true },
      );
    }
    const dayRow = await attendanceDayOn(ctx.uid, today);
    if (dayRow) {
      const keepPresent = dayRow.data["status"] === "present";
      await db.collection(DRIVER_ATTENDANCE).doc(dayRow.id).set(
        {
          first_online_at: dayRow.data["first_online_at"] ?? stamp,
          last_online_at: stamp,
          status: keepPresent ? "present" : "online_unvalidated",
          updated_at: stamp,
        },
        { merge: true },
      );
    } else {
      await db.collection(DRIVER_ATTENDANCE).add({
        driver_id: ctx.uid,
        attendance_date: today,
        first_online_at: stamp,
        last_online_at: stamp,
        online_seconds: 0,
        status: "online_unvalidated",
        created_at: stamp,
        updated_at: stamp,
      });
    }
  } else if (open) {
    const wentOnline = asDate(open.data["went_online_at"]);
    const elapsed = wentOnline
      ? Math.max(0, Math.floor((now.getTime() - wentOnline.getTime()) / 1000))
      : 0;
    await db.collection(COLLECTIONS.driverSessions).doc(open.id).set(
      { is_online: false, went_offline_at: stamp, updated_at: stamp },
      { merge: true },
    );
    const dayRow = await attendanceDayOn(ctx.uid, today);
    if (dayRow && dayRow.data["first_online_at"] != null) {
      const previous = Math.trunc(numberOrNull(dayRow.data["online_seconds"]) ?? 0);
      const keepPresent = dayRow.data["status"] === "present";
      await db.collection(DRIVER_ATTENDANCE).doc(dayRow.id).set(
        {
          online_seconds: previous + elapsed,
          last_online_at: stamp,
          status: keepPresent ? "present" : "online_unvalidated",
          updated_at: stamp,
        },
        { merge: true },
      );
    }
  }

  if (!isOnDuty) {
    await applyRiderCheckout({
      driverId: ctx.uid,
      reason: "manual",
      now,
      keepDutyWrite: false,
    });
  }

  let opKey = "duty.offline";
  if (isOnDuty !== wasOnDuty) {
    opKey = isOnDuty ? "duty.on" : "duty.off";
  } else if (isOnline) {
    opKey = "duty.online";
  }

  await logDriverOperation({
    driverId: ctx.uid,
    module: "duty",
    action: opKey,
    actor: "rpc",
    success: true,
    recordType: "driver",
    recordId: ctx.uid,
    detail: { is_on_duty: isOnDuty, is_online: isOnline, duty_changed: isOnDuty !== wasOnDuty },
  });

  const refreshed = await db.collection(COLLECTIONS.drivers).doc(ctx.uid).get();
  return loadRiderHomeDashboard({
    uid: ctx.uid,
    driver: (refreshed.data() ?? {}) as Dict,
    profile: ctx.profile,
    now,
  });
});
