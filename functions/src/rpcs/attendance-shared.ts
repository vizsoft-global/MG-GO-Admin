import { HttpsError } from "firebase-functions/v2/https";
import {
  getFirestore,
  type DocumentSnapshot,
  type Query,
  type QueryDocumentSnapshot,
  Timestamp,
} from "../core/fs";
import { COLLECTIONS, FIELDS } from "../core/collections";
import { kuwaitDayString } from "../core/kuwait";
import type { AppSettings } from "../core/settings";
import type { PhaseMarks } from "../perf/phase-log";
import { timedPhase } from "../perf/phase-log";
import {
  ATTENDANCE_PROJECTION,
  ATTENDANCE_KEYSET_PAGE,
  ATTENDANCE_MATERIALIZE_CAP,
  attendanceNeedsLocation,
  attendanceNeedsSessions,
  dutyIsOn,
  minutesLateOf,
} from "./attendance-live-plan";
import { attendanceDisplayName, attendanceIdentityMissing } from "./attendance-stamp";

const ATT = FIELDS.attendanceLogs;

/**
 * A single Firestore `getAll` request is bounded; 300 keeps each request well
 * inside the 10 MiB limit while still making a full roster a handful of round
 * trips instead of one per rider.
 */
const GET_ALL_CHUNK = 300;

/**
 * Date-ordered pages do not use this. problems_first and the computed statuses
 * keyset up to ATTENDANCE_MATERIALIZE_CAP. The old name stays so a caller that
 * imported the 5000 ceiling still compiles; the live ceiling is the materialize cap.
 */
export const ATTENDANCE_SCAN_CAP = ATTENDANCE_MATERIALIZE_CAP;

export const ATTENDANCE_WINDOW_TOO_LARGE = "attendance_window_too_large";

/** Stable code plus the sentence the panel shows when a window exceeds the scan cap. */
export const ATTENDANCE_WINDOW_TOO_LARGE_MESSAGE =
  "attendance_window_too_large: This date range has more attendance rows than the list can rank in one pass. Choose a shorter range.";

export function rethrowAttendanceWindow(error: unknown): never {
  if (error instanceof Error && error.message === ATTENDANCE_WINDOW_TOO_LARGE) {
    throw new HttpsError("failed-precondition", ATTENDANCE_WINDOW_TOO_LARGE_MESSAGE);
  }
  throw error;
}

export type AttendanceRow = {
  driver_id: string;
  log_date: string;
  driver_code: string | null;
  employee_id: string | null;
  driver_name: string;
  driver_phone: string | null;
  partner_id: string | null;
  partner_name: string | null;
  zone_id: string | null;
  zone_name: string | null;
  is_on_duty: boolean;
  shift_type: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  attendance_log_id: string | null;
  check_in_at: string | null;
  check_out_at: string | null;
  check_out_reason: string | null;
  attendance_status: string;
  online_seconds: number;
  duty_seconds: number;
  minutes_late: number;
  minutes_early_out: number;
  last_seen_at: string | null;
  gps_zone_status: string | null;
  gps_accuracy_meters: number | null;
  gps_is_mocked: boolean;
  live_status: string;
  compliance_score: number | null;
  check_in_photo_key: string | null;
  check_in_photo_at: string | null;
  check_in_restaurant_id: string | null;
  check_in_restaurant_name: string | null;
  check_in_distance_m: number | null;
};

function asDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  if (typeof value === "object" && value !== null && "seconds" in value) {
    const seconds = Number((value as { seconds: unknown }).seconds);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000);
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function secondsBetween(from: Date | null, to: Date | null): number {
  if (!from || !to) return 0;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
}

export type AttendanceQuery = {
  from: string;
  to: string;
  partnerId: string | null;
  zoneId: string | null;
  restaurantId: string | null;
};

/**
 * Reads the window and composes each row the way `v_attendance_daily` did.
 *
 * The view joined nine tables; here the per-rider facts (name, code, zone,
 * partner, restaurant links, shift window) are denormalised onto the attendance
 * document at write time, and only the two genuinely live inputs — the driver's
 * GPS row and their open session — are read at request time. Those two are the
 * whole reason the derivation cannot be a stored field: a status that says
 * "Offline during shift" is a claim about *now*, and a stored copy would keep
 * claiming it after the phone came back.
 */
async function readAttendanceKeyset(scoped: Query): Promise<QueryDocumentSnapshot[]> {
  const out: QueryDocumentSnapshot[] = [];
  let cursor: QueryDocumentSnapshot | null = null;
  while (out.length <= ATTENDANCE_MATERIALIZE_CAP) {
    let page = scoped
      .orderBy(ATT.logDate, "desc")
      .select(...ATTENDANCE_PROJECTION)
      .limit(ATTENDANCE_KEYSET_PAGE);
    if (cursor) page = page.startAfter(cursor);
    const snap = await page.get();
    if (snap.empty) break;
    for (const doc of snap.docs) out.push(doc);
    if (out.length > ATTENDANCE_MATERIALIZE_CAP) {
      throw new Error(ATTENDANCE_WINDOW_TOO_LARGE);
    }
    cursor = snap.docs[snap.docs.length - 1] ?? null;
    if (snap.size < ATTENDANCE_KEYSET_PAGE) break;
  }
  return out;
}

export type AttendancePage = {
  sort: "date_asc" | "date_desc";
  offset: number;
  limit: number;
  totalCount: number;
};

export async function loadAttendanceRows(
  query: AttendanceQuery,
  settings: AppSettings,
  options?: { page?: AttendancePage | null; phases?: PhaseMarks },
): Promise<AttendanceRow[]> {
  const db = getFirestore();
  const coll = db.collection(COLLECTIONS.attendanceLogs);
  const phases = options?.phases ?? {};

  let scoped = coll
    .where(ATT.logDate, ">=", query.from)
    .where(ATT.logDate, "<=", query.to);
  if (query.zoneId) scoped = scoped.where(ATT.zoneId, "==", query.zoneId);
  if (query.restaurantId) scoped = scoped.where("restaurant_ids", "array-contains", query.restaurantId);
  if (query.partnerId) scoped = scoped.where("partner_match_keys", "array-contains", query.partnerId);

  const page = options?.page ?? null;
  let raw;
  if (page) {
    const counted = await timedPhase(phases, "countMs", () => scoped.count().get());
    page.totalCount = counted.data().count;
    const direction = page.sort === "date_asc" ? "asc" : "desc";
    const snap = await timedPhase(phases, "logsMs", () =>
      scoped
        .orderBy(ATT.logDate, direction)
        .select(...ATTENDANCE_PROJECTION)
        .offset(page.offset)
        .limit(page.limit)
        .get(),
    );
    raw = snap.docs;
  } else {
    raw = await timedPhase(phases, "logsMs", () => readAttendanceKeyset(scoped));
  }
  if (!raw.length) return [];

  const now = new Date();
  const today = kuwaitDayString(now);
  const staleBefore = new Date(now.getTime() - settings.attendance_gps_stale_minutes * 60_000);
  const locationIds: string[] = [];
  const identityIds: string[] = [];
  let anyOnDuty = false;
  for (const doc of raw) {
    const data = doc.data() ?? {};
    const checkIn = asDate(data[ATT.checkInAt]);
    const checkOut = asDate(data[ATT.checkOutAt]);
    const scheduledStart = asDate(data[ATT.scheduledStartAt]);
    const logDate = asString(data[ATT.logDate]) ?? today;
    const minutesLate = minutesLateOf(checkIn, scheduledStart, settings.attendance_late_grace_minutes);
    if (dutyIsOn(data[ATT.isOnDuty] === true, checkIn, checkOut, logDate, today)) anyOnDuty = true;
    if (attendanceIdentityMissing(data)) identityIds.push(asString(data[ATT.driverId]) ?? doc.id);
    if (attendanceNeedsLocation({
      storedStatus: asString(data[ATT.status]),
      hasScheduledStart: Boolean(scheduledStart),
      hasCheckIn: Boolean(checkIn),
      minutesLate,
    })) {
      const driverId = asString(data[ATT.driverId]);
      if (driverId) locationIds.push(driverId);
    }
  }

  const locationByDriver = await timedPhase(phases, "locationsMs", () => loadLocations(locationIds));
  const identity = identityIds.length
    ? await timedPhase(phases, "identityMs", () => loadIdentity(identityIds))
    : new Map<string, AttendanceIdentity>();
  const openSessions = attendanceNeedsSessions(anyOnDuty)
    ? await timedPhase(phases, "sessionsMs", () => loadOpenSessions())
    : new Map<string, Date>();

  return raw.map((doc) =>
    composeRow(doc, now, today, staleBefore, settings, locationByDriver, openSessions, identity),
  );
}

async function loadLocations(driverIds: Array<string | null>) {
  const db = getFirestore();
  const ids = [...new Set(driverIds.filter((id): id is string => Boolean(id)))];
  const out = new Map<string, DocumentSnapshot>();
  for (let index = 0; index < ids.length; index += GET_ALL_CHUNK) {
    const chunk = ids.slice(index, index + GET_ALL_CHUNK);
    const snaps = await db.getAll(
      ...chunk.map((id) => db.collection(COLLECTIONS.driverLocations).doc(id)),
    );
    for (const snap of snaps) out.set(snap.id, snap);
  }
  return out;
}

type AttendanceIdentity = {
  full_name: string | null;
  name: string | null;
  driver_code: string | null;
  employee_id: string | null;
};

/**
 * The identity columns a legacy `attendance_logs` row never stored. Only the
 * rows that are actually missing one of them are looked up, so a healthy month
 * costs nothing and an un-backfilled one still prints a name instead of "#".
 */
async function loadIdentity(driverIds: string[]): Promise<Map<string, AttendanceIdentity>> {
  const db = getFirestore();
  const ids = [...new Set(driverIds.filter((id) => Boolean(id)))];
  const out = new Map<string, AttendanceIdentity>();
  const blank = (): AttendanceIdentity => ({
    full_name: null,
    name: null,
    driver_code: null,
    employee_id: null,
  });
  for (let index = 0; index < ids.length; index += GET_ALL_CHUNK) {
    const chunk = ids.slice(index, index + GET_ALL_CHUNK);
    const [driverSnaps, profileSnaps] = await Promise.all([
      db.getAll(...chunk.map((id) => db.collection(COLLECTIONS.drivers).doc(id))),
      db.getAll(...chunk.map((id) => db.collection(COLLECTIONS.profiles).doc(id))),
    ]);
    for (const snap of driverSnaps) {
      const raw = snap.data() ?? {};
      out.set(snap.id, {
        ...(out.get(snap.id) ?? blank()),
        name: asString(raw[FIELDS.drivers.name]),
        driver_code: asString(raw[FIELDS.drivers.driverCode]),
        employee_id: asString(raw[FIELDS.drivers.employeeId]),
      });
    }
    for (const snap of profileSnaps) {
      const raw = snap.data() ?? {};
      out.set(snap.id, {
        ...(out.get(snap.id) ?? blank()),
        full_name: asString(raw["full_name"]),
      });
    }
  }
  return out;
}

async function loadOpenSessions() {
  const db = getFirestore();
  const snap = await db.collection(COLLECTIONS.driverSessions).where("is_online", "==", true).get();
  const out = new Map<string, Date>();
  for (const doc of snap.docs) {
    const driverId = asString(doc.get(ATT.driverId));
    const wentOnline = asDate(doc.get("went_online_at"));
    if (driverId && wentOnline) out.set(driverId, wentOnline);
  }
  return out;
}

function composeRow(
  doc: DocumentSnapshot,
  now: Date,
  today: string,
  staleBefore: Date,
  settings: AppSettings,
  locations: Map<string, DocumentSnapshot>,
  openSessions: Map<string, Date>,
  identity: Map<string, AttendanceIdentity>,
): AttendanceRow {
  const raw = doc.data() ?? {};
  const driverId = asString(raw[ATT.driverId]) ?? doc.id;
  const logDate = asString(raw[ATT.logDate]) ?? kuwaitDayString(now);

  const checkIn = asDate(raw[ATT.checkInAt]);
  const checkOut = asDate(raw[ATT.checkOutAt]);
  const scheduledStart = asDate(raw[ATT.scheduledStartAt]);
  const scheduledEnd = asDate(raw[ATT.scheduledEndAt]);

  const location = locations.get(driverId)?.data();
  const lastSeen = asDate(location?.[FIELDS.driverLocations.at]);
  const gpsZoneStatus = asString(location?.["zone_status"]);
  const gpsAccuracy = typeof location?.[FIELDS.driverLocations.accuracyMeters] === "number"
    ? (location[FIELDS.driverLocations.accuracyMeters] as number)
    : null;
  const gpsMocked = location?.["is_mocked"] === true;

  const isOnDuty = dutyIsOn(raw[ATT.isOnDuty] === true, checkIn, checkOut, logDate, today);

  const openSessionAt = openSessions.get(driverId);
  const sessionLiveSeconds = openSessionAt
    ? Math.max(0, Math.round((now.getTime() - openSessionAt.getTime()) / 1000))
    : 0;
  const onlineSeconds = asNumber(raw["online_seconds"]) + sessionLiveSeconds;

  const dutySeconds = checkOut
    ? secondsBetween(checkIn, checkOut)
    : isOnDuty
      ? secondsBetween(checkIn, now)
      : 0;

  const minutesLate = minutesLateOf(checkIn, scheduledStart, settings.attendance_late_grace_minutes);

  const minutesEarlyOut = checkOut && scheduledEnd && scheduledStart
    ? Math.min(
        Math.max(
          0,
          Math.floor(
            (scheduledEnd.getTime() - Math.max(checkOut.getTime(), scheduledStart.getTime())) /
              60_000,
          ) - settings.attendance_early_out_grace_minutes,
        ),
        Math.max(0, Math.floor((scheduledEnd.getTime() - scheduledStart.getTime()) / 60_000)),
      )
    : 0;

  const storedStatus = asString(raw[ATT.status]);
  const attendanceStatus =
    storedStatus === "on_leave"
      ? "on_leave"
      : checkIn
        ? "present"
        : "absent";

  // The live status is the view's CASE in its original evaluation order. The
  // order is load-bearing: `on_leave` outranks `no_shift` because a rider on
  // approved leave usually has no shift row, and reading that as "No shift" is
  // the bug the view's `on_leave` branch was added to fix.
  let liveStatus: string;
  if (storedStatus === "on_leave") {
    liveStatus = "on_leave";
  } else if (!scheduledStart) {
    liveStatus = "no_shift";
  } else if (!checkIn) {
    liveStatus = "absent";
  } else if (minutesLate > 0) {
    liveStatus = "late";
  } else if (isOnDuty && (!openSessionAt || !lastSeen || lastSeen < staleBefore)) {
    liveStatus = "offline_during_shift";
  } else if (gpsZoneStatus === "out_of_zone") {
    liveStatus = "outside_zone";
  } else if (checkOut) {
    liveStatus = "completed";
  } else if (isOnDuty) {
    liveStatus = "on_duty";
  } else if (checkIn) {
    liveStatus = "present";
  } else {
    liveStatus = "scheduled";
  }

  let complianceScore: number | null;
  if (!checkIn || !scheduledStart) {
    complianceScore = null;
  } else if (minutesLate > 0) {
    complianceScore = 70;
  } else if (dutySeconds > 0) {
    complianceScore = Math.min(100, Math.round((onlineSeconds / dutySeconds) * 100));
  } else {
    complianceScore = 100;
  }

  const identityRow = identity.get(driverId);
  const fallbackName = attendanceDisplayName(
    identityRow?.full_name,
    identityRow?.name,
    identityRow?.driver_code,
  );

  return {
    driver_id: driverId,
    log_date: logDate,
    driver_code: asString(raw[ATT.driverCode]) ?? identityRow?.driver_code ?? null,
    employee_id: asString(raw[ATT.employeeId]) ?? identityRow?.employee_id ?? null,
    driver_name: asString(raw[ATT.driverName]) ?? fallbackName ?? "",
    driver_phone: asString(raw[ATT.driverPhone]),
    partner_id: asString(raw[ATT.partnerId]),
    partner_name: asString(raw[ATT.partnerName]),
    zone_id: asString(raw[ATT.zoneId]),
    zone_name: asString(raw[ATT.zoneName]),
    is_on_duty: isOnDuty,
    shift_type: asString(raw[ATT.shiftType]),
    scheduled_start_at: iso(scheduledStart),
    scheduled_end_at: iso(scheduledEnd),
    attendance_log_id: asString(raw[ATT.attendanceLogId]) ?? doc.id,
    check_in_at: iso(checkIn),
    check_out_at: iso(checkOut),
    check_out_reason: asString(raw[ATT.checkOutReason]),
    attendance_status: attendanceStatus,
    online_seconds: onlineSeconds,
    duty_seconds: dutySeconds,
    minutes_late: minutesLate,
    minutes_early_out: minutesEarlyOut,
    last_seen_at: iso(lastSeen),
    gps_zone_status: gpsZoneStatus,
    gps_accuracy_meters: gpsAccuracy,
    gps_is_mocked: gpsMocked,
    live_status: liveStatus,
    compliance_score: complianceScore,
    check_in_photo_key: asString(raw[ATT.checkInPhotoKey]),
    check_in_photo_at: iso(asDate(raw[ATT.checkInPhotoAt])),
    check_in_restaurant_id: asString(raw[ATT.checkInRestaurantId]),
    check_in_restaurant_name: asString(raw[ATT.checkInRestaurantName]),
    check_in_distance_m: asNumber(raw[ATT.checkInDistanceM]) ?? null,
  };
}
