import { FieldValue, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";

import { COLLECTIONS } from "@/lib/firebase/db";
import { haversineMeters } from "@/features/locations/location-status";
import { addDays, kuwaitToday } from "@/features/driver-tracking/kuwait-time";
import { evaluateEarlyDrop, type EarlyDropThresholds } from "@/features/roster/early-drop-eval";
import { rosterDutyStatus, type RosterDutyStatus } from "@/features/roster/roster-adherence";
import { parseRestaurantZoneSheet, parseRosterSheet, type RosterShiftDraft } from "@/features/roster/roster-sheet";

const SHIFTS = COLLECTIONS.driverDailyShifts;
const ALERTS = "ops_alerts";
const STAFF_ZONES = "staff_zone_access";
const SETTINGS = COLLECTIONS.appSettings;

export type RosterScope = { all: boolean; zoneIds: string[] };

export type RosterReportRow = {
  driverId: string;
  driverName: string;
  employeeId: string;
  date: string;
  restaurantId: string | null;
  restaurantName: string;
  zoneId: string | null;
  zoneName: string;
  company: string;
  off: boolean;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  actualIn: string | null;
  actualOut: string | null;
  status: RosterDutyStatus;
  minutesLate: number;
  minutesEarly: number;
  earlyDrops: Array<{
    deliveryId: string;
    orderId: string;
    pickupAt: string | null;
    deliveredAt: string | null;
    meters: number | null;
  }>;
};

type DriverHit = { id: string; name: string; company: string; employeeId: string };

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "object" && value && "toDate" in value && typeof (value as { toDate: () => Date }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Kuwait wall time. Asia/Kuwait is UTC+3 with no daylight saving. */
export function kuwaitInstant(date: string, hms: string, dayOffset = 0): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes, seconds] = hms.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day + dayOffset, (hours || 0) - 3, minutes || 0, seconds || 0));
}

function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  let cursor = from;
  while (cursor <= to && days.length < 32) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

async function readThresholds(db: Firestore): Promise<{ late: number; early: number; drop: EarlyDropThresholds }> {
  const snap = await db.collection(SETTINGS).doc("1").get();
  const data = snap.data() ?? {};
  const late = num(data.roster_late_grace_minutes) ?? 15;
  const early = num(data.roster_early_grace_minutes) ?? 10;
  return {
    late,
    early,
    drop: {
      nearMeters: num(data.roster_early_drop_restaurant_meters) ?? 200,
      minMinutes: num(data.roster_early_drop_min_minutes) ?? 4,
      customerFarMeters: num(data.roster_early_drop_customer_meters) ?? 500,
      flagMissingProof: data.roster_early_drop_missing_proof !== false,
    },
  };
}

export async function readRosterSettings(db: Firestore) {
  const thresholds = await readThresholds(db);
  return {
    lateGraceMinutes: thresholds.late,
    earlyGraceMinutes: thresholds.early,
    nearMeters: thresholds.drop.nearMeters,
    minMinutes: thresholds.drop.minMinutes,
    flagMissingProof: thresholds.drop.flagMissingProof,
  };
}

export async function writeRosterSettings(
  db: Firestore,
  input: { lateGraceMinutes: number; earlyGraceMinutes: number; nearMeters: number; minMinutes: number; flagMissingProof: boolean },
) {
  await db.collection(SETTINGS).doc("1").set(
    {
      roster_late_grace_minutes: input.lateGraceMinutes,
      roster_early_grace_minutes: input.earlyGraceMinutes,
      roster_early_drop_restaurant_meters: input.nearMeters,
      roster_early_drop_min_minutes: input.minMinutes,
      roster_early_drop_missing_proof: input.flagMissingProof,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

async function driverIndex(db: Firestore): Promise<{ byKey: Map<string, DriverHit>; ambiguous: Set<string> }> {
  const byKey = new Map<string, DriverHit>();
  const ambiguous = new Set<string>();
  let cursor: QueryDocumentSnapshot | undefined;
  for (let page = 0; page < 20; page++) {
    let query = db.collection(COLLECTIONS.drivers).limit(500);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.archived_at) continue;
      const hit: DriverHit = {
        id: doc.id,
        name: str(data.full_name) || str(data.name),
        company: str(data.source_company) || str(data.company_name),
        employeeId: str(data.employee_id) || str(data.driver_code),
      };
      for (const key of [str(data.employee_id), str(data.driver_code), str(data.client_id)]) {
        if (!key) continue;
        const existing = byKey.get(key);
        if (existing && existing.id !== hit.id) {
          ambiguous.add(key);
          byKey.delete(key);
        } else if (!ambiguous.has(key)) byKey.set(key, hit);
      }
    }
    if (snap.size < 500) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return { byKey, ambiguous };
}

async function nameIndex(db: Firestore, collection: string, field: string): Promise<Map<string, { id: string; name: string }>> {
  const map = new Map<string, { id: string; name: string }>();
  const snap = await db.collection(collection).limit(2000).get();
  for (const doc of snap.docs) {
    const name = str(doc.data()[field]);
    if (!name) continue;
    map.set(name.toLowerCase(), { id: doc.id, name });
  }
  return map;
}

export async function previewRosterImport(db: Firestore, aoa: unknown[][]) {
  const parsed = parseRosterSheet(aoa);
  if (parsed.headerError) return { error: parsed.headerError as "empty" | "missing_columns" };
  const { byKey, ambiguous } = await driverIndex(db);
  const restaurants = await nameIndex(db, COLLECTIONS.restaurants, "name");
  const rows = parsed.drafts.map((draft) => {
    const errors = [...draft.errors];
    const driver = byKey.get(draft.driverKey);
    if (ambiguous.has(draft.driverKey)) errors.push("ambiguous_driver");
    else if (!driver) errors.push("unknown_driver");
    const restaurant = draft.storeName ? restaurants.get(draft.storeName.toLowerCase()) : undefined;
    if (draft.storeName && !restaurant) errors.push("unknown_restaurant");
    return { ...draft, errors: [...new Set(errors)], driverId: driver?.id ?? null, driverLabel: driver?.name || draft.driverName, restaurantId: restaurant?.id ?? null };
  });
  return {
    rows,
    ready: rows.filter((row) => row.errors.length === 0).length,
    failed: rows.filter((row) => row.errors.length > 0).length,
  };
}

export async function applyRosterImport(db: Firestore, aoa: unknown[][]) {
  const preview = await previewRosterImport(db, aoa);
  if ("error" in preview) return preview;
  const ready = preview.rows.filter((row) => row.errors.length === 0 && row.driverId && row.date);
  let written = 0;
  for (let i = 0; i < ready.length; i += 200) {
    const batch = db.batch();
    const slice = ready.slice(i, i + 200);
    for (const row of slice) {
      const existing = await db.collection(SHIFTS).where("driver_id", "==", row.driverId).where("shift_date", "==", row.date).limit(1).get();
      const ref = existing.empty ? db.collection(SHIFTS).doc(`${row.driverId}_${row.date}`) : existing.docs[0].ref;
      batch.set(
        ref,
        {
          driver_id: row.driverId,
          shift_date: row.date,
          shift_type: row.off ? "single" : row.shiftType,
          is_off: row.off,
          source: "roster",
          session1_start: row.off ? null : row.session1Start,
          session1_end: row.off ? null : row.session1End,
          session1_end_day_offset: row.session1EndDayOffset,
          session2_start: row.off ? null : row.session2Start,
          session2_end: row.off ? null : row.session2End,
          session2_start_day_offset: 0,
          session2_end_day_offset: row.session2EndDayOffset,
          restaurant_id: row.restaurantId,
          store_cc: row.storeCc,
          store_name: row.storeName,
          notes: row.notes,
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    await batch.commit();
    written += slice.length;
  }
  const today = kuwaitToday();
  if (ready.some((row) => row.date <= today)) await sweepRosterDay(db, today);
  return { written, failed: preview.failed };
}

export async function applyRestaurantZones(db: Firestore, aoa: unknown[][]) {
  const rows = parseRestaurantZoneSheet(aoa);
  if (rows.length === 0) return { error: "missing_columns" as const };
  const restaurants = await nameIndex(db, COLLECTIONS.restaurants, "name");
  const zones = await nameIndex(db, COLLECTIONS.zones, "name");
  let written = 0;
  const failed: Array<{ row: number; error: string }> = [];
  const batch = db.batch();
  for (const row of rows) {
    const restaurant = restaurants.get(row.store.toLowerCase());
    const zone = zones.get(row.zone.toLowerCase());
    if (!restaurant) {
      failed.push({ row: row.row, error: "unknown_restaurant" });
      continue;
    }
    if (!zone) {
      failed.push({ row: row.row, error: "unknown_zone" });
      continue;
    }
    batch.set(db.collection(COLLECTIONS.restaurants).doc(restaurant.id), { zone_id: zone.id, updated_at: FieldValue.serverTimestamp() }, { merge: true });
    written += 1;
  }
  if (written > 0) await batch.commit();
  return { written, failed };
}

export async function saveStaffZones(db: Firestore, userId: string, zoneIds: string[]) {
  await db.collection(STAFF_ZONES).doc(userId).set({ zone_ids: zoneIds, updated_at: FieldValue.serverTimestamp() }, { merge: true });
}

export async function listZoneStaff(db: Firestore) {
  const [people, zones, access] = await Promise.all([
    db.collection(COLLECTIONS.profiles).where("role", "==", "staff").limit(400).get(),
    db.collection(COLLECTIONS.zones).limit(200).get(),
    db.collection(STAFF_ZONES).limit(400).get(),
  ]);
  const accessByUser = new Map<string, string[]>();
  for (const doc of access.docs) {
    const ids = doc.data().zone_ids;
    accessByUser.set(doc.id, Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []);
  }
  return {
    zones: zones.docs.map((doc) => ({ id: doc.id, name: str(doc.data().name) || doc.id })),
    staff: people.docs.map((doc) => ({
      id: doc.id,
      name: str(doc.data().full_name) || str(doc.data().email) || doc.id,
      zoneIds: accessByUser.get(doc.id) ?? [],
    })),
  };
}

export async function callerZoneScope(db: Firestore, userId: string, unrestricted: boolean): Promise<RosterScope> {
  if (unrestricted) return { all: true, zoneIds: [] };
  const snap = await db.collection(STAFF_ZONES).doc(userId).get();
  const ids = snap.data()?.zone_ids;
  return { all: false, zoneIds: Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [] };
}

async function zoneName(db: Firestore, cache: Map<string, string>, zoneId: string | null): Promise<string> {
  if (!zoneId) return "";
  const cached = cache.get(zoneId);
  if (cached != null) return cached;
  const snap = await db.collection(COLLECTIONS.zones).doc(zoneId).get();
  const name = str(snap.data()?.name);
  cache.set(zoneId, name);
  return name;
}

async function restaurantZone(db: Firestore, restaurantId: string | null): Promise<{ zoneId: string | null; name: string }> {
  if (!restaurantId) return { zoneId: null, name: "" };
  const snap = await db.collection(COLLECTIONS.restaurants).doc(restaurantId).get();
  const data = snap.data() ?? {};
  return { zoneId: str(data.zone_id) || null, name: str(data.name) };
}

function inScope(scope: RosterScope, zoneId: string | null): boolean {
  if (scope.all) return true;
  return zoneId != null && scope.zoneIds.includes(zoneId);
}

async function shiftsForDay(db: Firestore, day: string) {
  const snap = await db.collection(SHIFTS).where("shift_date", "==", day).limit(2000).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Record<string, unknown> & { id: string });
}

async function attendanceForDay(db: Firestore, day: string) {
  const snap = await db.collection(COLLECTIONS.attendanceLogs).where("log_date", "==", day).limit(3000).get();
  const byDriver = new Map<string, { checkIn: Date | null; checkOut: Date | null }>();
  for (const doc of snap.docs) {
    const data = doc.data();
    const driverId = str(data.driver_id);
    if (!driverId) continue;
    const checkIn = asDate(data.check_in_at);
    const checkOut = asDate(data.check_out_at);
    const current = byDriver.get(driverId);
    if (!current) byDriver.set(driverId, { checkIn, checkOut });
    else {
      if (checkIn && (!current.checkIn || checkIn < current.checkIn)) current.checkIn = checkIn;
      if (checkOut && (!current.checkOut || checkOut > current.checkOut)) current.checkOut = checkOut;
    }
  }
  return byDriver;
}

function shiftWindow(row: Record<string, unknown>, day: string): { start: Date | null; end: Date | null; startLabel: string | null; endLabel: string | null } {
  const startHms = str(row.session1_start);
  const endHms = str(row.session2_end) || str(row.session1_end);
  const endOffset = str(row.session2_end) ? Number(row.session2_end_day_offset) || 0 : Number(row.session1_end_day_offset) || 0;
  if (!startHms || !endHms || row.is_off === true) return { start: null, end: null, startLabel: null, endLabel: null };
  return {
    start: kuwaitInstant(day, startHms, 0),
    end: kuwaitInstant(day, endHms, endOffset),
    startLabel: startHms.slice(0, 5),
    endLabel: endHms.slice(0, 5),
  };
}

export async function sweepRosterDay(db: Firestore, day: string) {
  const thresholds = await readThresholds(db);
  const now = new Date();
  const [shifts, attendance] = await Promise.all([shiftsForDay(db, day), attendanceForDay(db, day)]);
  let written = 0;
  let pending = 0;
  let batch = db.batch();
  for (const shift of shifts) {
    const driverId = str(shift.driver_id);
    if (!driverId || shift.source !== "roster") continue;
    const window = shiftWindow(shift, day);
    const log = attendance.get(driverId);
    const duty = rosterDutyStatus({
      off: shift.is_off === true,
      start: window.start,
      end: window.end,
      checkIn: log?.checkIn ?? null,
      checkOut: log?.checkOut ?? null,
      now,
      lateGraceMin: thresholds.late,
      earlyGraceMin: thresholds.early,
    });
    if (duty.status !== "late" && duty.status !== "not_logged_in" && duty.status !== "no_show" && duty.status !== "logged_out_early") {
      continue;
    }
    const restaurantId = str(shift.restaurant_id) || null;
    const place = await restaurantZone(db, restaurantId);
    const ref = db.collection(ALERTS).doc(`${duty.status}_${driverId}_${day}`);
    batch.set(
      ref,
      {
        kind: duty.status,
        driver_id: driverId,
        zone_id: place.zoneId,
        restaurant_id: restaurantId,
        day,
        minutes_late: duty.minutesLate,
        minutes_early: duty.minutesEarly,
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    written += 1;
    pending += 1;
    if (pending === 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();
  return { written };
}

export async function listRosterAlerts(db: Firestore, scope: RosterScope, day: string) {
  const snap = await db.collection(ALERTS).where("day", "==", day).limit(1000).get();
  const rows = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    const zoneId = str(data.zone_id) || null;
    if (!inScope(scope, zoneId)) continue;
    rows.push({
      id: doc.id,
      kind: str(data.kind),
      driverId: str(data.driver_id),
      zoneId,
      restaurantId: str(data.restaurant_id) || null,
      deliveryId: str(data.delivery_id) || null,
      day,
      minutesLate: num(data.minutes_late) ?? 0,
      minutesEarly: num(data.minutes_early) ?? 0,
    });
  }
  return rows;
}

export async function loadRosterLive(db: Firestore, scope: RosterScope) {
  const day = kuwaitToday();
  const thresholds = await readThresholds(db);
  const [shifts, attendance, drops] = await Promise.all([
    shiftsForDay(db, day),
    attendanceForDay(db, day),
    db.collection(COLLECTIONS.deliveries).where("delivered_day", "==", day).where("is_early_drop", "==", true).limit(500).get().catch(() => null),
  ]);
  const earlyDrivers = new Set<string>();
  if (drops) {
    for (const doc of drops.docs) {
      const driverId = str(doc.data().driver_id);
      if (driverId) earlyDrivers.add(driverId);
    }
  }
  const zoneCache = new Map<string, string>();
  const drivers = [];
  const restaurants = new Map<string, string>();
  for (const shift of shifts) {
    if (shift.source !== "roster") continue;
    const driverId = str(shift.driver_id);
    const restaurantId = str(shift.restaurant_id) || null;
    const place = await restaurantZone(db, restaurantId);
    if (!inScope(scope, place.zoneId)) continue;
    const window = shiftWindow(shift, day);
    const log = attendance.get(driverId);
    const duty = rosterDutyStatus({
      off: shift.is_off === true,
      start: window.start,
      end: window.end,
      checkIn: log?.checkIn ?? null,
      checkOut: log?.checkOut ?? null,
      now: new Date(),
      lateGraceMin: thresholds.late,
      earlyGraceMin: thresholds.early,
    });
    if (restaurantId && place.name) restaurants.set(restaurantId, place.name || str(shift.store_name));
    drivers.push({
      driverId,
      restaurantId,
      restaurantName: place.name || str(shift.store_name),
      zoneId: place.zoneId,
      zoneName: await zoneName(db, zoneCache, place.zoneId),
      status: duty.status,
      start: window.startLabel,
      end: window.endLabel,
      actualIn: log?.checkIn?.toISOString() ?? null,
      earlyDrop: earlyDrivers.has(driverId),
    });
  }
  return {
    restricted: !scope.all,
    drivers,
    restaurants: [...restaurants.entries()].map(([id, name]) => ({ id, name })),
    manager: scope.all,
  };
}

export async function loadDriverRoster(db: Firestore, driverId: string) {
  const today = kuwaitToday();
  const days = eachDay(addDays(today, -1), addDays(today, 6));
  const snaps = await Promise.all(
    days.map((day) => db.collection(SHIFTS).where("driver_id", "==", driverId).where("shift_date", "==", day).limit(1).get()),
  );
  return days.map((day, index) => {
    const doc = snaps[index]?.docs[0];
    const data = doc?.data() ?? {};
    const window = shiftWindow(data, day);
    return {
      date: day,
      off: data.is_off === true,
      source: str(data.source) || null,
      storeName: str(data.store_name),
      notes: str(data.notes),
      start: window.startLabel,
      end: window.endLabel,
      split: data.shift_type === "split",
    };
  });
}

export async function loadRosterReport(
  db: Firestore,
  scope: RosterScope,
  filter: { from: string; to: string; zoneId?: string | null; restaurantId?: string | null; company?: string | null; driverId?: string | null },
): Promise<{ rows: RosterReportRow[] } | { error: "range_too_large" }> {
  if (filter.from > filter.to) return { rows: [] };
  const days = eachDay(filter.from, filter.to);
  if (days.length > 31) return { error: "range_too_large" };
  const thresholds = await readThresholds(db);
  const rows: RosterReportRow[] = [];
  const names = new Map<string, DriverHit>();
  const zoneCache = new Map<string, string>();
  for (const day of days) {
    const [shifts, attendance, deliveries] = await Promise.all([
      shiftsForDay(db, day),
      attendanceForDay(db, day),
      db.collection(COLLECTIONS.deliveries).where("delivered_day", "==", day).limit(2500).get(),
    ]);
    const dropsByDriver = new Map<string, RosterReportRow["earlyDrops"]>();
    for (const doc of deliveries.docs) {
      const data = doc.data();
      const driverId = str(data.driver_id);
      if (!driverId) continue;
      const pickupLat = num(data.pickup_lat);
      const pickupLng = num(data.pickup_lng);
      const dropLat = num(data.delivered_lat);
      const dropLng = num(data.delivered_lng);
      const pickupAt = asDate(data.pickup_at);
      const deliveredAt = asDate(data.delivered_at);
      const duration = pickupAt && deliveredAt ? (deliveredAt.getTime() - pickupAt.getTime()) / 60_000 : null;
      const meters = pickupLat != null && pickupLng != null && dropLat != null && dropLng != null ? haversineMeters(pickupLat, pickupLng, dropLat, dropLng) : null;
      const proof = data.pickup_proof_urls;
      const missing = !str(data.pickup_proof_url) && !(Array.isArray(proof) && proof.length > 0);
      const stamped = data.is_early_drop === true;
      const verdict = evaluateEarlyDrop({
        pickupToDropMeters: meters,
        restaurantToDropMeters: null,
        durationMinutes: duration,
        missingPickupProof: missing,
        customerToDropMeters: null,
        thresholds: thresholds.drop,
      });
      if (!stamped && !verdict.early) continue;
      const list = dropsByDriver.get(driverId) ?? [];
      list.push({
        deliveryId: doc.id,
        orderId: str(data.external_order_id),
        pickupAt: pickupAt?.toISOString() ?? null,
        deliveredAt: deliveredAt?.toISOString() ?? null,
        meters,
      });
      dropsByDriver.set(driverId, list);
    }
    for (const shift of shifts) {
      if (shift.source !== "roster") continue;
      const driverId = str(shift.driver_id);
      if (filter.driverId && driverId !== filter.driverId) continue;
      const restaurantId = str(shift.restaurant_id) || null;
      if (filter.restaurantId && restaurantId !== filter.restaurantId) continue;
      const place = await restaurantZone(db, restaurantId);
      if (!inScope(scope, place.zoneId)) continue;
      if (filter.zoneId && place.zoneId !== filter.zoneId) continue;
      let driver = names.get(driverId);
      if (!driver) {
        const snap = await db.collection(COLLECTIONS.drivers).doc(driverId).get();
        const profile = await db.collection(COLLECTIONS.profiles).doc(driverId).get();
        const data = snap.data() ?? {};
        driver = {
          id: driverId,
          name: str(profile.data()?.full_name) || str(data.full_name),
          company: str(data.source_company) || str(data.company_name),
          employeeId: str(data.employee_id) || str(data.driver_code),
        };
        names.set(driverId, driver);
      }
      if (filter.company && driver.company.toLowerCase() !== filter.company.toLowerCase()) continue;
      const window = shiftWindow(shift, day);
      const log = attendance.get(driverId);
      const duty = rosterDutyStatus({
        off: shift.is_off === true,
        start: window.start,
        end: window.end,
        checkIn: log?.checkIn ?? null,
        checkOut: log?.checkOut ?? null,
        now: new Date(),
        lateGraceMin: thresholds.late,
        earlyGraceMin: thresholds.early,
      });
      rows.push({
        driverId,
        driverName: driver.name,
        employeeId: driver.employeeId,
        date: day,
        restaurantId,
        restaurantName: place.name || str(shift.store_name),
        zoneId: place.zoneId,
        zoneName: await zoneName(db, zoneCache, place.zoneId),
        company: driver.company,
        off: shift.is_off === true,
        scheduledStart: window.startLabel,
        scheduledEnd: window.endLabel,
        actualIn: log?.checkIn?.toISOString() ?? null,
        actualOut: log?.checkOut?.toISOString() ?? null,
        status: duty.status,
        minutesLate: duty.minutesLate,
        minutesEarly: duty.minutesEarly,
        earlyDrops: dropsByDriver.get(driverId) ?? [],
      });
    }
  }
  return { rows };
}

export type { RosterShiftDraft };
