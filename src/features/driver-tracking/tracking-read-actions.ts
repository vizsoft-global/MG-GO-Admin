"use server";

export type { ShiftAdherence } from "./shift-adherence";

import { logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { parseTrackingStatus } from "@/features/locations/location-status";
import type { DriverLocationEvent } from "@/features/locations/types";
import { computeHistorySummary } from "@/features/live-tracking/history-summary-kpis";
import {
  kuwaitDateFromIso,
  kuwaitDayBounds,
  kuwaitToday,
  logDurationSeconds,
} from "./kuwait-time";
import {
  adherenceMapKey,
  parseShiftAdherence,
  type ShiftAdherence,
} from "./shift-adherence";
import {
  findActiveShiftRow,
  formatSessionRange,
  shiftRowToListFields,
  type ShiftRow,
} from "./shift-flags";

async function requireAttendanceView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "attendance.view", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

async function fetchAdherenceMap(
  fromDate: string,
  toDate: string,
  driverIds?: string[],
): Promise<Map<string, ShiftAdherence>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_shift_adherence", {
    p_from: fromDate,
    p_to: toDate,
    p_driver_ids: driverIds && driverIds.length > 0 ? driverIds : undefined,
  });
  if (error) throw error;

  const map = new Map<string, ShiftAdherence>();
  for (const row of data ?? []) {
    const parsed = parseShiftAdherence(row.shift_adherence);
    if (parsed) {
      map.set(adherenceMapKey(row.driver_id, row.attendance_date), parsed);
    }
  }
  return map;
}

async function fetchShiftAdherence(
  driverId: string,
  date: string,
): Promise<ShiftAdherence | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_get_shift_adherence", {
    p_driver_id: driverId,
    p_date: date,
  });
  if (error) throw error;
  return parseShiftAdherence(data);
}

function buildDriverShiftListRow(
  row: ShiftRow,
  driver: DriverMeta,
  shiftAdherence: ShiftAdherence | null = null,
  nowMs: number = Date.now(),
): DriverShiftListRow {
  const fields = shiftRowToListFields(row, nowMs);
  return {
    id: row.id,
    driver_id: row.driver_id,
    driver_code: driver.driver_code,
    driver_name: driver.full_name,
    driver_phone: driver.phone,
    zone_name: driver.zone_name,
    partner_name: driver.partner_name,
    shift_date: row.shift_date,
    shift_type: row.shift_type as "single" | "split",
    session1_label: fields.session1_label,
    session2_label: fields.session2_label,
    is_within_window: fields.is_within_window,
    is_locked: fields.is_locked,
    is_active: fields.is_active,
    is_expired: fields.is_expired,
    shift_end_at: fields.shift_end_at,
    is_on_duty: driver.is_on_duty,
    submitted_at: row.submitted_at,
    shift_adherence: shiftAdherence,
  };
}

type DriverMeta = {
  id: string;
  driver_code: string;
  is_on_duty: boolean;
  zone_id: string | null;
  partner_id: string | null;
  zone_name: string;
  partner_name: string;
  full_name: string;
  phone: string;
};

async function fetchDriverMetaMap(): Promise<Map<string, DriverMeta>> {
  const supabase = await createClient();
  const { data: drivers, error } = await supabase
    .from("drivers")
    .select(
      "id, driver_code, is_on_duty, zone_id, partner_id, status, archived_at, zones(name), partners(name)",
    )
    .eq("status", "active")
    .is("archived_at", null);

  if (error) throw error;

  const ids = (drivers ?? []).map((d) => d.id);
  const profileById = new Map<string, { full_name: string | null; phone: string | null }>();
  if (ids.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, phone")
      .in("id", ids);
    for (const p of profiles ?? []) {
      profileById.set(p.id, { full_name: p.full_name, phone: p.phone });
    }
  }

  const map = new Map<string, DriverMeta>();
  for (const d of drivers ?? []) {
    const zones = d.zones as { name: string } | { name: string }[] | null;
    const partners = d.partners as { name: string } | { name: string }[] | null;
    const zoneName = Array.isArray(zones) ? zones[0]?.name : zones?.name;
    const partnerName = Array.isArray(partners) ? partners[0]?.name : partners?.name;
    const prof = profileById.get(d.id);
    map.set(d.id, {
      id: d.id,
      driver_code: d.driver_code,
      is_on_duty: d.is_on_duty,
      zone_id: d.zone_id,
      partner_id: d.partner_id,
      zone_name: zoneName?.trim() || "—",
      partner_name: partnerName?.trim() || "—",
      full_name: prof?.full_name?.trim() || "—",
      phone: prof?.phone?.trim() || "—",
    });
  }
  return map;
}

export type DriverShiftListRow = {
  id: string;
  driver_id: string;
  driver_code: string;
  driver_name: string;
  driver_phone: string;
  zone_name: string;
  partner_name: string;
  shift_date: string;
  shift_type: "single" | "split";
  session1_label: string;
  session2_label: string | null;
  is_within_window: boolean;
  is_locked: boolean;
  is_active: boolean;
  is_expired: boolean;
  shift_end_at: string;
  is_on_duty: boolean;
  submitted_at: string;
  shift_adherence: ShiftAdherence | null;
};

export async function fetchDriverShiftsList(params: {
  fromDate: string;
  toDate: string;
  zoneId?: string;
  partnerId?: string;
}): Promise<DriverShiftListRow[]> {
  await requireAttendanceView();
  void logAdminRead("driver_daily_shifts", "fetchDriverShiftsList", params);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("driver_daily_shifts")
    .select("*")
    .gte("shift_date", params.fromDate)
    .lte("shift_date", params.toDate)
    .order("shift_date", { ascending: false });

  if (error) throw error;

  const meta = await fetchDriverMetaMap();
  const adherenceMap = await fetchAdherenceMap(params.fromDate, params.toDate);
  const rows: DriverShiftListRow[] = [];

  for (const raw of data ?? []) {
    const row = raw as ShiftRow;
    const driver = meta.get(row.driver_id);
    if (!driver) continue;
    if (params.zoneId && params.zoneId !== "all" && driver.zone_id !== params.zoneId) continue;
    if (params.partnerId && params.partnerId !== "all" && driver.partner_id !== params.partnerId) {
      continue;
    }

    const adherence =
      adherenceMap.get(adherenceMapKey(row.driver_id, row.shift_date)) ?? null;

    rows.push(buildDriverShiftListRow(row, driver, adherence));
  }

  return rows;
}

export type WorktimeListRow = {
  key: string;
  driver_id: string;
  driver_code: string;
  driver_name: string;
  driver_phone: string;
  zone_name: string;
  partner_name: string;
  attendance_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  log_duration_seconds: number | null;
  online_seconds: number;
  session_count: number;
  distance_meters: number | null;
  idle_minutes: number | null;
  moving_minutes: number | null;
  attendance_status: string | null;
  is_validated: boolean;
  validation_source: string | null;
  is_on_duty: boolean;
  log_id: string | null;
  first_online_at: string | null;
  shift_type: "single" | "split" | null;
  session1_label: string | null;
  session2_label: string | null;
  shift_adherence: ShiftAdherence | null;
};

function displayOnlineSeconds(
  base: number,
  attendanceDate: string,
  lastOnlineAt: string | null,
  hasOpenSession: boolean,
): number {
  const today = kuwaitToday();
  if (attendanceDate !== today || !hasOpenSession || !lastOnlineAt) return base;
  const extra = Math.max(0, Math.floor((Date.now() - new Date(lastOnlineAt).getTime()) / 1000));
  return base + extra;
}

export async function fetchWorktimeList(params: {
  fromDate: string;
  toDate: string;
  zoneId?: string;
  partnerId?: string;
}): Promise<WorktimeListRow[]> {
  await requireAttendanceView();
  void logAdminRead("worktime", "fetchWorktimeList", params);

  const supabase = await createClient();
  const meta = await fetchDriverMetaMap();
  const driverIds = [...meta.keys()];
  if (driverIds.length === 0) return [];

  const { from: rangeFrom } = kuwaitDayBounds(params.fromDate);
  const { to: rangeTo } = kuwaitDayBounds(params.toDate);

  const [attendanceRes, logsRes, sessionsRes, eventsRes, shiftsRes, adherenceMap] =
    await Promise.all([
    supabase
      .from("driver_attendance")
      .select("*")
      .gte("attendance_date", params.fromDate)
      .lte("attendance_date", params.toDate)
      .in("driver_id", driverIds),
    supabase
      .from("attendance_logs")
      .select(
        "id, driver_id, log_date, check_in_at, check_out_at, distance_meters, status",
      )
      .gte("log_date", params.fromDate)
      .lte("log_date", params.toDate)
      .in("driver_id", driverIds),
    supabase
      .from("driver_sessions")
      .select("id, driver_id, is_online, went_online_at, went_offline_at")
      .in("driver_id", driverIds)
      .gte("went_online_at", rangeFrom)
      .lte("went_online_at", rangeTo),
    supabase
      .from("driver_location_events")
      .select(
        "id, driver_id, latitude, longitude, speed_mps, accuracy_meters, battery_pct, tracking_status, zone_status, delivery_id, recorded_at",
      )
      .in("driver_id", driverIds)
      .gte("recorded_at", rangeFrom)
      .lte("recorded_at", rangeTo)
      .order("recorded_at", { ascending: true }),
    supabase
      .from("driver_daily_shifts")
      .select("*")
      .gte("shift_date", params.fromDate)
      .lte("shift_date", params.toDate)
      .in("driver_id", driverIds),
    fetchAdherenceMap(params.fromDate, params.toDate, driverIds),
  ]);

  if (attendanceRes.error) throw attendanceRes.error;
  if (logsRes.error) throw logsRes.error;
  if (sessionsRes.error) throw sessionsRes.error;
  if (eventsRes.error) throw eventsRes.error;
  if (shiftsRes.error) throw shiftsRes.error;

  const shiftByKey = new Map<string, ShiftRow>();
  for (const raw of shiftsRes.data ?? []) {
    const row = raw as ShiftRow;
    shiftByKey.set(adherenceMapKey(row.driver_id, row.shift_date), row);
  }

  const openSessionDrivers = new Set(
    (sessionsRes.data ?? []).filter((s) => s.is_online).map((s) => s.driver_id),
  );

  const sessionCountByKey = new Map<string, number>();
  for (const s of sessionsRes.data ?? []) {
    if (!s.went_online_at) continue;
    const day = kuwaitDateFromIso(s.went_online_at);
    if (day < params.fromDate || day > params.toDate) continue;
    const key = `${s.driver_id}:${day}`;
    sessionCountByKey.set(key, (sessionCountByKey.get(key) ?? 0) + 1);
  }

  const eventsByKey = new Map<string, DriverLocationEvent[]>();
  for (const raw of eventsRes.data ?? []) {
    const day = kuwaitDateFromIso(raw.recorded_at);
    const key = `${raw.driver_id}:${day}`;
    const list = eventsByKey.get(key) ?? [];
    list.push({
      id: raw.id,
      driverId: raw.driver_id,
      latitude: Number(raw.latitude),
      longitude: Number(raw.longitude),
      speedMps: raw.speed_mps != null ? Number(raw.speed_mps) : null,
      accuracyMeters: raw.accuracy_meters != null ? Number(raw.accuracy_meters) : null,
      batteryPct: raw.battery_pct,
      trackingStatus: parseTrackingStatus(raw.tracking_status),
      zoneStatus: raw.zone_status as DriverLocationEvent["zoneStatus"],
      deliveryId: raw.delivery_id,
      recordedAt: raw.recorded_at,
    });
    eventsByKey.set(key, list);
  }

  const logByKey = new Map<string, (typeof logsRes.data)[number]>();
  for (const log of logsRes.data ?? []) {
    logByKey.set(`${log.driver_id}:${log.log_date}`, log);
  }

  const attendanceByKey = new Map<string, (typeof attendanceRes.data)[number]>();
  for (const a of attendanceRes.data ?? []) {
    attendanceByKey.set(`${a.driver_id}:${a.attendance_date}`, a);
  }

  const keys = new Set<string>();
  for (const k of attendanceByKey.keys()) keys.add(k);
  for (const k of logByKey.keys()) keys.add(k);

  const rows: WorktimeListRow[] = [];

  for (const key of keys) {
    const sep = key.indexOf(":");
    const driverId = key.slice(0, sep);
    const date = key.slice(sep + 1);
    if (!driverId || !date) continue;
    const driver = meta.get(driverId);
    if (!driver) continue;
    if (params.zoneId && params.zoneId !== "all" && driver.zone_id !== params.zoneId) continue;
    if (params.partnerId && params.partnerId !== "all" && driver.partner_id !== params.partnerId) {
      continue;
    }

    const att = attendanceByKey.get(key);
    const log = logByKey.get(key);
    const events = eventsByKey.get(key) ?? [];
    const summary = computeHistorySummary(events);
    const shiftRow = shiftByKey.get(key);
    const shiftAdherence = adherenceMap.get(key) ?? null;
    const shiftFields = shiftRow ? shiftRowToListFields(shiftRow) : null;

    rows.push({
      key,
      driver_id: driverId,
      driver_code: driver.driver_code,
      driver_name: driver.full_name,
      driver_phone: driver.phone,
      zone_name: driver.zone_name,
      partner_name: driver.partner_name,
      attendance_date: date,
      check_in_at: log?.check_in_at ?? null,
      check_out_at: log?.check_out_at ?? null,
      log_duration_seconds: logDurationSeconds(
        log?.check_in_at ?? null,
        log?.check_out_at ?? null,
      ),
      online_seconds: displayOnlineSeconds(
        att?.online_seconds ?? 0,
        date,
        att?.last_online_at ?? null,
        openSessionDrivers.has(driverId),
      ),
      session_count: sessionCountByKey.get(key) ?? 0,
      distance_meters: log?.distance_meters ?? null,
      idle_minutes: summary.idleMinutes,
      moving_minutes: summary.movingMinutes,
      attendance_status: att?.status ?? null,
      is_validated: att?.is_validated ?? false,
      validation_source: att?.validation_source ?? null,
      is_on_duty: driver.is_on_duty,
      log_id: log?.id ?? null,
      first_online_at: att?.first_online_at ?? null,
      shift_type: shiftRow ? (shiftRow.shift_type as "single" | "split") : null,
      session1_label: shiftFields?.session1_label ?? null,
      session2_label: shiftFields?.session2_label ?? null,
      shift_adherence: shiftAdherence,
    });
  }

  return rows;
}

export async function fetchDriverAttendanceMonth(
  driverId: string,
  year: number,
  month: number,
): Promise<
  {
    attendance_date: string;
    online_seconds: number;
    status: string;
    is_validated: boolean;
    shift_adherence: ShiftAdherence | null;
  }[]
> {
  await requireAttendanceView();
  const supabase = await createClient();
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const [{ data, error }, adherenceMap] = await Promise.all([
    supabase
      .from("driver_attendance")
      .select("attendance_date, online_seconds, status, is_validated, last_online_at")
      .eq("driver_id", driverId)
      .gte("attendance_date", monthStart)
      .lte("attendance_date", monthEnd)
      .order("attendance_date", { ascending: true }),
    fetchAdherenceMap(monthStart, monthEnd, [driverId]),
  ]);

  if (error) throw error;

  const { data: openSession } = await supabase
    .from("driver_sessions")
    .select("id")
    .eq("driver_id", driverId)
    .eq("is_online", true)
    .maybeSingle();

  const today = kuwaitToday();
  return (data ?? []).map((row) => ({
    attendance_date: row.attendance_date,
    online_seconds: displayOnlineSeconds(
      row.online_seconds ?? 0,
      row.attendance_date,
      row.last_online_at,
      Boolean(openSession) && row.attendance_date === today,
    ),
    status: row.status,
    is_validated: row.is_validated,
    shift_adherence:
      adherenceMap.get(adherenceMapKey(driverId, row.attendance_date)) ?? null,
  }));
}

export type FleetOpsCounts = {
  on_duty: number;
  online_sessions: number;
  unvalidated_today: number;
  out_of_zone: number;
};

export async function fetchFleetOpsCounts(): Promise<FleetOpsCounts> {
  await requireAttendanceView();
  const supabase = await createClient();
  const today = kuwaitToday();

  const [driversRes, sessionsRes, attendanceRes, locationsRes] = await Promise.all([
    supabase
      .from("drivers")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .is("archived_at", null)
      .eq("is_on_duty", true),
    supabase
      .from("driver_sessions")
      .select("id", { count: "exact", head: true })
      .eq("is_online", true),
    supabase
      .from("driver_attendance")
      .select("id", { count: "exact", head: true })
      .eq("attendance_date", today)
      .eq("status", "online_unvalidated"),
    supabase
      .from("driver_locations")
      .select("id", { count: "exact", head: true })
      .eq("zone_status", "out_of_zone"),
  ]);

  return {
    on_duty: driversRes.count ?? 0,
    online_sessions: sessionsRes.count ?? 0,
    unvalidated_today: attendanceRes.count ?? 0,
    out_of_zone: locationsRes.count ?? 0,
  };
}

async function fetchSingleDriverMeta(driverId: string): Promise<DriverMeta | null> {
  const supabase = await createClient();
  const { data: d, error } = await supabase
    .from("drivers")
    .select(
      "id, driver_code, is_on_duty, zone_id, partner_id, zones(name), partners(name)",
    )
    .eq("id", driverId)
    .maybeSingle();

  if (error) throw error;
  if (!d) return null;

  const { data: prof } = await supabase
    .from("profiles")
    .select("full_name, phone")
    .eq("id", driverId)
    .maybeSingle();

  const zones = d.zones as { name: string } | { name: string }[] | null;
  const partners = d.partners as { name: string } | { name: string }[] | null;
  const zoneName = Array.isArray(zones) ? zones[0]?.name : zones?.name;
  const partnerName = Array.isArray(partners) ? partners[0]?.name : partners?.name;

  return {
    id: d.id,
    driver_code: d.driver_code,
    is_on_duty: d.is_on_duty,
    zone_id: d.zone_id,
    partner_id: d.partner_id,
    zone_name: zoneName?.trim() || "—",
    partner_name: partnerName?.trim() || "—",
    full_name: prof?.full_name?.trim() || "—",
    phone: prof?.phone?.trim() || "—",
  };
}

export async function fetchDriverTodayTrackingSummary(driverId: string): Promise<{
  shift: DriverShiftListRow | null;
  worktime: WorktimeListRow | null;
  shift_adherence: ShiftAdherence | null;
}> {
  await requireAttendanceView();
  const today = kuwaitToday();
  const supabase = await createClient();
  const { from: rangeFrom, to: rangeTo } = kuwaitDayBounds(today);
  const yesterday = (() => {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  const [
    driver,
    shiftsRes,
    attendanceRes,
    logRes,
    sessionsRes,
    eventsRes,
    openSessionRes,
    shiftAdherence,
  ] = await Promise.all([
    fetchSingleDriverMeta(driverId),
    supabase
      .from("driver_daily_shifts")
      .select("*")
      .eq("driver_id", driverId)
      .in("shift_date", [today, yesterday]),
    supabase
      .from("driver_attendance")
      .select("*")
      .eq("driver_id", driverId)
      .eq("attendance_date", today)
      .maybeSingle(),
    supabase
      .from("attendance_logs")
      .select(
        "id, driver_id, log_date, check_in_at, check_out_at, distance_meters, status",
      )
      .eq("driver_id", driverId)
      .eq("log_date", today)
      .maybeSingle(),
    supabase
      .from("driver_sessions")
      .select("id, driver_id, is_online, went_online_at, went_offline_at")
      .eq("driver_id", driverId)
      .gte("went_online_at", rangeFrom)
      .lte("went_online_at", rangeTo),
    supabase
      .from("driver_location_events")
      .select(
        "id, driver_id, latitude, longitude, speed_mps, accuracy_meters, battery_pct, tracking_status, zone_status, delivery_id, recorded_at",
      )
      .eq("driver_id", driverId)
      .gte("recorded_at", rangeFrom)
      .lte("recorded_at", rangeTo)
      .order("recorded_at", { ascending: true }),
    supabase
      .from("driver_sessions")
      .select("id")
      .eq("driver_id", driverId)
      .eq("is_online", true)
      .maybeSingle(),
    fetchShiftAdherence(driverId, today),
  ]);

  if (sessionsRes.error) throw sessionsRes.error;
  if (eventsRes.error) throw eventsRes.error;
  if (shiftsRes.error) throw shiftsRes.error;
  if (attendanceRes.error) throw attendanceRes.error;
  if (logRes.error) throw logRes.error;

  if (!driver) return { shift: null, worktime: null, shift_adherence: null };

  const shiftRows = (shiftsRes.data ?? []) as ShiftRow[];
  const activeShift = findActiveShiftRow(shiftRows, today);
  const todayShift = shiftRows.find((r) => r.shift_date === today) ?? null;
  const displayShiftRow = activeShift ?? todayShift;

  let shift: DriverShiftListRow | null = null;
  if (displayShiftRow) {
    shift = buildDriverShiftListRow(displayShiftRow, driver, shiftAdherence);
  }

  const att = attendanceRes.data;
  const log = logRes.data;
  const hasOpenSession = Boolean(openSessionRes.data);
  const events = (eventsRes.data ?? []).map((raw) => ({
    id: raw.id,
    driverId: raw.driver_id,
    latitude: Number(raw.latitude),
    longitude: Number(raw.longitude),
    speedMps: raw.speed_mps != null ? Number(raw.speed_mps) : null,
    accuracyMeters: raw.accuracy_meters != null ? Number(raw.accuracy_meters) : null,
    batteryPct: raw.battery_pct,
    trackingStatus: parseTrackingStatus(raw.tracking_status),
    zoneStatus: raw.zone_status as DriverLocationEvent["zoneStatus"],
    deliveryId: raw.delivery_id,
    recordedAt: raw.recorded_at,
  }));
  const summary = computeHistorySummary(events);

  let sessionCount = 0;
  for (const s of sessionsRes.data ?? []) {
    if (!s.went_online_at) continue;
    if (kuwaitDateFromIso(s.went_online_at) === today) sessionCount += 1;
  }

  const worktime: WorktimeListRow | null =
    att || log
      ? {
          key: `${driverId}:${today}`,
          driver_id: driverId,
          driver_code: driver.driver_code,
          driver_name: driver.full_name,
          driver_phone: driver.phone,
          zone_name: driver.zone_name,
          partner_name: driver.partner_name,
          attendance_date: today,
          check_in_at: log?.check_in_at ?? null,
          check_out_at: log?.check_out_at ?? null,
          log_duration_seconds: logDurationSeconds(
            log?.check_in_at ?? null,
            log?.check_out_at ?? null,
          ),
          online_seconds: displayOnlineSeconds(
            att?.online_seconds ?? 0,
            today,
            att?.last_online_at ?? null,
            hasOpenSession,
          ),
          session_count: sessionCount,
          distance_meters: log?.distance_meters ?? null,
          idle_minutes: summary.idleMinutes,
          moving_minutes: summary.movingMinutes,
          attendance_status: att?.status ?? null,
          is_validated: att?.is_validated ?? false,
          validation_source: att?.validation_source ?? null,
          is_on_duty: driver.is_on_duty,
          log_id: log?.id ?? null,
          first_online_at: att?.first_online_at ?? null,
          shift_type: displayShiftRow
            ? (displayShiftRow.shift_type as "single" | "split")
            : null,
          session1_label: shift?.session1_label ?? null,
          session2_label: shift?.session2_label ?? null,
          shift_adherence: shiftAdherence,
        }
      : null;

  return { shift, worktime, shift_adherence: shiftAdherence };
}
