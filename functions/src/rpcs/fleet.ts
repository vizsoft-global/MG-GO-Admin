import { onCall } from "firebase-functions/v2/https";
import { Timestamp, getFirestore, type Query } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { kuwaitDayEnd, kuwaitDayStart, kuwaitDayString } from "../core/kuwait";
import { parseId, parseIdList, parseInstant } from "../core/query";
import { requireStaff } from "../core/staff";

const FLEET_EVENT_ID_CEILING = 9223372036854775807;

export type Dict = Record<string, unknown>;
export type Row = { id: string } & Dict;
export const EMPTY_ROW: Row = { id: "" };

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "object" && value !== null && "seconds" in value) {
    const seconds = Number((value as { seconds: unknown }).seconds);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000).toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

export function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function asDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  if (typeof value === "object" && value !== null && "seconds" in value) {
    const seconds = Number((value as { seconds: unknown }).seconds);
    return Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/** `driver_freeze_is_active(frozen_from, frozen_until)` — inclusive window. */
function freezeActive(driver: Dict, at: Date): boolean {
  const from = asDate(driver.frozen_from);
  const until = asDate(driver.frozen_until);
  if (from && at < from) return false;
  if (until && at > until) return false;
  return Boolean(from || until);
}

export async function loadDocMap(
  collection: string,
  ids: readonly string[],
): Promise<Map<string, Row>> {
  const unique = Array.from(new Set(ids.filter((id) => id.length > 0)));
  const out = new Map<string, Row>();
  if (!unique.length) return out;
  const db = getFirestore();
  const refs = unique.map((id) => db.collection(collection).doc(id));
  const snaps = await db.getAll(...refs);
  for (const snap of snaps) {
    if (snap.exists) out.set(snap.id, { ...(snap.data() as Dict), id: snap.id } as Row);
  }
  return out;
}

export async function loadAllDocs(collection: string): Promise<Row[]> {
  const snap = await getFirestore().collection(collection).get();
  return snap.docs.map((doc) => toRow(doc.id, doc.data() as Dict));
}

export function toRow(id: string, data: Dict | undefined): Row {
  const row: Row = { id };
  return Object.assign(row, data ?? {});
}

/** `_fleet_settings()` — the thresholds the rail and the pins are rendered against. */
async function fleetSettings(): Promise<Dict> {
  const snap = await getFirestore().collection(COLLECTIONS.appSettings).doc("1").get();
  const data = (snap.data() ?? {}) as Dict;
  const read = (key: string, fallback: number): number => {
    const value = num(data[key]);
    return value === null ? fallback : value;
  };
  return {
    gps_offline_seconds: read("gps_offline_seconds", 90),
    gps_stale_seconds: read("gps_stale_seconds", 150),
    overspeed_kmh: read("overspeed_kmh", 60),
    low_battery_pct: read("low_battery_pct", 15),
    idle_seconds: read("idle_seconds", 300),
    seen_within_minutes: read("fleet_seen_within_minutes", 30),
  };
}

export type LiveFleetZone = {
  id: string;
  name: string | null;
  color: string | null;
  zone_type: string | null;
  geometry: unknown;
};

export async function buildLiveFleetSnapshot(seenWithinMinutes: number) {
  const seenWithin = Math.max(Math.trunc(seenWithinMinutes || 30), 1);
  const now = new Date();
  const day = kuwaitDayString(now);
  const dayStart = kuwaitDayStart(day);
  const dayEnd = kuwaitDayEnd(day);
  const cutoff = new Date(now.getTime() - seenWithin * 60 * 1000);

  const db = getFirestore();

  const [driverSnaps, zoneDocs, partnerDocs, restaurantDocs, vehicleDocs, todayCreatedSnap, todayDeliveredSnap, openSnap, shiftSnap, attendanceSnap, sessionSnap, settings] =
    await Promise.all([
      db.collection(COLLECTIONS.drivers).where("archived_at", "==", null).get(),
      loadAllDocs(COLLECTIONS.zones),
      loadAllDocs(COLLECTIONS.partners),
      loadAllDocs(COLLECTIONS.restaurants),
      loadAllDocs(COLLECTIONS.vehicles),
      db
        .collection(COLLECTIONS.deliveries)
        .where("created_at", ">=", dayStart)
        .where("created_at", "<", dayEnd)
        .get(),
      db
        .collection(COLLECTIONS.deliveries)
        .where("delivered_at", ">=", dayStart)
        .where("delivered_at", "<", dayEnd)
        .get(),
      db.collection(COLLECTIONS.deliveries).where("status", "==", "in_transit").get(),
      db.collection(COLLECTIONS.driverDailyShifts).where("shift_date", "==", day).get(),
      db.collection(COLLECTIONS.attendanceLogs).where("log_date", "==", day).get(),
      db.collection(COLLECTIONS.driverSessions).where("is_online", "==", true).get(),
      fleetSettings(),
    ]);

  const zoneById = new Map(zoneDocs.map((doc) => [String(doc.id), doc] as const));
  const partnerById = new Map(partnerDocs.map((doc) => [String(doc.id), doc] as const));
  const restaurantById = new Map(restaurantDocs.map((doc) => [String(doc.id), doc] as const));
  const vehicleById = new Map(vehicleDocs.map((doc) => [String(doc.id), doc] as const));

  const createdToday = new Map<string, number>();
  for (const doc of todayCreatedSnap.docs) {
    const row = doc.data() as Dict;
    if (row.status === "cancelled") continue;
    const driverId = parseId(row.driver_id);
    if (!driverId) continue;
    createdToday.set(driverId, (createdToday.get(driverId) ?? 0) + 1);
  }

  const deliveredToday = new Map<string, number>();
  for (const doc of todayDeliveredSnap.docs) {
    const driverId = parseId((doc.data() as Dict).driver_id);
    if (!driverId) continue;
    deliveredToday.set(driverId, (deliveredToday.get(driverId) ?? 0) + 1);
  }

  const openByDriver = new Map<string, { id: string; pickupAt: Date | null; createdAt: Date | null }>();
  for (const doc of openSnap.docs) {
    const row = doc.data() as Dict;
    const driverId = parseId(row.driver_id);
    if (!driverId) continue;
    const candidate = {
      id: doc.id,
      pickupAt: asDate(row.pickup_at),
      createdAt: asDate(row.created_at),
    };
    const current = openByDriver.get(driverId);
    const better =
      !current ||
      (candidate.pickupAt ?? new Date(0)).getTime() > (current.pickupAt ?? new Date(0)).getTime() ||
      ((candidate.pickupAt ?? new Date(0)).getTime() === (current.pickupAt ?? new Date(0)).getTime() &&
        (candidate.createdAt ?? new Date(0)).getTime() > (current.createdAt ?? new Date(0)).getTime());
    if (better) openByDriver.set(driverId, candidate);
  }

  const shiftByDriver = new Map<string, Dict>();
  for (const doc of shiftSnap.docs) {
    const row = doc.data() as Dict;
    const driverId = parseId(row.driver_id);
    if (driverId) shiftByDriver.set(driverId, row);
  }

  const attendanceByDriver = new Map<string, Date>();
  for (const doc of attendanceSnap.docs) {
    const row = doc.data() as Dict;
    const driverId = parseId(row.driver_id);
    if (!driverId) continue;
    const checkIn = asDate(row.check_in_at);
    if (!checkIn) continue;
    const current = attendanceByDriver.get(driverId);
    if (!current || checkIn.getTime() > current.getTime()) attendanceByDriver.set(driverId, checkIn);
  }

  const onlineDrivers = new Set<string>();
  for (const doc of sessionSnap.docs) {
    const driverId = parseId((doc.data() as Dict).driver_id);
    if (driverId) onlineDrivers.add(driverId);
  }

  const driverIds = driverSnaps.docs.map((doc) => doc.id);
  const [profileById, locationById] = await Promise.all([
    loadDocMap(COLLECTIONS.profiles, driverIds),
    loadDocMap(COLLECTIONS.driverLocations, driverIds),
  ]);

  const vehicles = driverSnaps.docs
    .map((doc) => {
      const driver = { ...(doc.data() as Dict), id: doc.id } as Row;
      const location = locationById.get(doc.id) ?? EMPTY_ROW;
      const open = openByDriver.get(doc.id) ?? null;
      const blocked = Boolean(driver.is_blocked) || freezeActive(driver, now);
      const lastSeenAt = asDate(location.last_seen_at);
      if (!driver.is_on_duty && !blocked && !(lastSeenAt && lastSeenAt >= cutoff) && !open) {
        return null;
      }

      const profile = profileById.get(doc.id) ?? EMPTY_ROW;
      const zone = driver.zone_id ? zoneById.get(String(driver.zone_id)) : undefined;
      const partner = driver.partner_id ? partnerById.get(String(driver.partner_id)) : undefined;
      const restaurant = driver.restaurant_id
        ? restaurantById.get(String(driver.restaurant_id))
        : undefined;
      const vehicle = driver.vehicle_id ? vehicleById.get(String(driver.vehicle_id)) : undefined;
      const fullName =
        typeof profile.full_name === "string" ? profile.full_name.trim() : "";
      const shift = shiftByDriver.get(doc.id);
      const shiftType = shift ? (shift.shift_type as string | null) ?? null : null;
      const session1Start = shift ? shift.session1_start : null;
      const session1End = shift ? shift.session1_end : null;

      return {
        driver_id: doc.id,
        driver_name: fullName.length ? fullName : (driver.driver_code as string | null) ?? null,
        driver_code: (driver.driver_code as string | null) ?? null,
        employee_id: (driver.employee_id as string | null) ?? null,
        avatar_object_key: (driver.avatar_object_key as string | null) ?? null,
        avatar_updated_at: iso(driver.avatar_updated_at),
        avatar_url: (profile.avatar_url as string | null) ?? null,
        phone: (profile.phone as string | null) ?? null,
        account_status: (driver.status as string | null) ?? null,
        is_on_duty: Boolean(driver.is_on_duty),
        is_blocked: blocked,
        zone_id: (driver.zone_id as string | null) ?? null,
        zone_name: zone ? (zone.name as string | null) ?? null : null,
        zone_color: zone ? (zone.color as string | null) ?? null : null,
        partner_id: (driver.partner_id as string | null) ?? null,
        partner_name: partner ? (partner.name as string | null) ?? null : null,
        restaurant_id: (driver.restaurant_id as string | null) ?? null,
        restaurant_name: restaurant ? (restaurant.name as string | null) ?? null : null,
        vehicle_id: (driver.vehicle_id as string | null) ?? null,
        vehicle_reg_number: vehicle ? (vehicle.reg_number as string | null) ?? null : null,
        vehicle_bike_id: vehicle ? (vehicle.bike_id as string | null) ?? null : null,
        vehicle_type_key:
          (vehicle?.vehicle_type_key as string | null) ??
          (driver.vehicle_type_key as string | null) ??
          "bike",
        latitude: num(location.latitude),
        longitude: num(location.longitude),
        speed_mps: num(location.speed_mps),
        heading_deg: num(location.heading_deg),
        accuracy_meters: num(location.accuracy_meters),
        battery_pct: num(location.battery_pct),
        is_mocked: typeof location.is_mocked === "boolean" ? location.is_mocked : null,
        tracking_status: (location.tracking_status as string | null) ?? null,
        zone_status: (location.zone_status as string | null) ?? null,
        out_of_zone_since: iso(location.out_of_zone_since),
        distance_today_meters: num(location.distance_today_meters),
        active_delivery_id: open ? open.id : null,
        last_seen_at: iso(location.last_seen_at),
        last_report_at: iso(location.last_report_at),
        is_online: onlineDrivers.has(doc.id),
        on_duty_since: iso(attendanceByDriver.get(doc.id) ?? null),
        deliveries_today: createdToday.get(doc.id) ?? 0,
        deliveries_completed_today: deliveredToday.get(doc.id) ?? 0,
        shift: shift
          ? {
              shift_date: (shift.shift_date as string | null) ?? null,
              shift_type: shiftType,
              session1_start_at: iso(session1Start),
              session1_end_at: iso(session1End),
              session2_start_at: iso(shift.session2_start),
              session2_end_at: iso(shift.session2_end),
              submitted_at: iso(shift.submitted_at),
            }
          : null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => (iso(b.last_seen_at) ?? "").localeCompare(iso(a.last_seen_at) ?? ""));

  return {
    generated_at: now.toISOString(),
    kuwait_day: day,
    settings,
    drivers: vehicles,
    zones: zoneDocs.map((doc) => ({
      id: String(doc.id),
      name: typeof doc.name === "string" ? doc.name : null,
      color: typeof doc.color === "string" ? doc.color : null,
      zone_type: typeof doc.zone_type === "string" ? doc.zone_type : null,
      geometry: doc.geometry ?? null,
    })),
  };
}

export function snapshotForStaff<T extends { zones: readonly LiveFleetZone[] }>(
  built: T,
): Omit<T, "zones"> {
  const snapshot = { ...built } as Omit<T, "zones"> & { zones?: readonly LiveFleetZone[] };
  delete snapshot.zones;
  return snapshot;
}

export const adminLiveFleetSnapshot = onCall(async (request) => {
  await requireStaff(request);
  const data = (request.data ?? {}) as Dict;
  const seenWithin = num(data.seenWithinMinutes ?? data.p_seen_within_minutes) ?? 30;
  return snapshotForStaff(await buildLiveFleetSnapshot(seenWithin));
});

export const adminListFleetEvents = onCall(async (request) => {
  await requireStaff(request);

  const data = (request.data ?? {}) as Dict;
  const driverId = parseId(data.driverId);
  const eventKeys = parseIdList(data.eventKeys);
  const severities = parseIdList(data.severities);
  const from = parseInstant(data.from, "from");
  const to = parseInstant(data.to, "to");
  const cursorDetectedAt = parseInstant(data.cursorDetectedAt, "cursor_detected_at");
  const cursorId = num(data.cursorId) ?? data.cursorId;
  const limit = Math.min(Math.max(Math.trunc(num(data.limit) ?? 50), 1), 200);

  let query: Query = getFirestore().collection(COLLECTIONS.fleetEvents);
  if (driverId) query = query.where("driver_id", "==", driverId);
  if (eventKeys && eventKeys.length) query = query.where("event_key", "in", eventKeys);
  if (severities && severities.length) query = query.where("severity", "in", severities);
  if (from) query = query.where("detected_at", ">=", from);
  if (to) query = query.where("detected_at", "<=", to);

  query = query.orderBy("detected_at", "desc").orderBy("id", "desc");
  if (cursorDetectedAt) {
    query = query.startAfter(
      Timestamp.fromDate(cursorDetectedAt),
      cursorId === null || cursorId === undefined ? FLEET_EVENT_ID_CEILING : cursorId,
    );
  }

  const snap = await query.limit(limit + 1).get();
  const hasMore = snap.docs.length > limit;
  const page = hasMore ? snap.docs.slice(0, limit) : snap.docs;

  const driverIds = page
    .map((doc) => parseId((doc.data() as Dict).driver_id))
    .filter((id): id is string => id !== null);
  const zoneIds = page
    .map((doc) => parseId((doc.data() as Dict).zone_id))
    .filter((id): id is string => id !== null);
  const [profileById, driverById, zoneById] = await Promise.all([
    loadDocMap(COLLECTIONS.profiles, driverIds),
    loadDocMap(COLLECTIONS.drivers, driverIds),
    loadDocMap(COLLECTIONS.zones, zoneIds),
  ]);

  const events = page.map((doc) => {
    const row = doc.data() as Dict;
    const eventDriverId = parseId(row.driver_id);
    const driver = eventDriverId ? driverById.get(eventDriverId) : undefined;
    const profile = eventDriverId ? profileById.get(eventDriverId) : undefined;
    const zoneId = parseId(row.zone_id);
    const zone = zoneId ? zoneById.get(zoneId) : undefined;
    const fullName = typeof profile?.full_name === "string" ? profile.full_name.trim() : "";
    return {
      id: row.id ?? doc.id,
      driver_id: eventDriverId,
      driver_name: fullName.length ? fullName : (driver?.driver_code as string | null) ?? null,
      driver_code: (driver?.driver_code as string | null) ?? null,
      event_key: (row.event_key as string | null) ?? null,
      severity: (row.severity as string | null) ?? null,
      status_before: row.status_before ?? null,
      status_after: row.status_after ?? null,
      value: row.value ?? null,
      zone_id: zoneId,
      zone_name: zone ? (zone.name as string | null) ?? null : null,
      latitude: num(row.latitude),
      longitude: num(row.longitude),
      context: row.context ?? null,
      detected_at: iso(row.detected_at),
      source: (row.source as string | null) ?? null,
    };
  });

  return { events, has_more: hasMore };
});
