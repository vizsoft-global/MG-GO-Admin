"use server";

import { hasPermissionInSet } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/get-session";
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
import { staffDb } from "@/lib/firebase/staff-db";
import {
  applyRestaurantZones,
  applyRosterImport,
  callerZoneScope,
  listRosterAlerts,
  listZoneStaff,
  loadDriverRoster,
  loadRosterLive,
  loadRosterReport,
  previewRosterImport,
  readRosterSettings,
  saveStaffZones,
  sweepRosterDay,
  writeRosterSettings,
} from "@/features/roster/roster-data";
import { kuwaitToday } from "@/features/driver-tracking/kuwait-time";

async function manageDb() {
  const auth = await requireMutationAuth("attendance.manage");
  if ("error" in auth) return auth;
  const db = await staffDb();
  if (!db) return { error: "not_configured" as const };
  return { db };
}

async function viewDb() {
  const session = await getSessionUser();
  if (!session) return { error: "not_authorized" as const };
  const allowed =
    session.isManager ||
    hasPermissionInSet(session.permissions, "attendance.view", session.isSuperAdmin);
  if (!allowed) return { error: "not_authorized" as const };
  const db = await staffDb();
  if (!db) return { error: "not_configured" as const };
  const scope = await callerZoneScope(db, session.id, session.isSuperAdmin || session.isManager);
  return { db, scope };
}

export async function previewRosterSheet(aoa: unknown[][]) {
  const gate = await manageDb();
  if ("error" in gate) return gate;
  return previewRosterImport(gate.db, aoa);
}

export async function applyRosterSheet(aoa: unknown[][]) {
  const gate = await manageDb();
  if ("error" in gate) return gate;
  return applyRosterImport(gate.db, aoa);
}

export async function importRestaurantZoneSheet(aoa: unknown[][]) {
  const auth = await requireMutationAuth("zones.manage");
  if ("error" in auth) return auth;
  const db = await staffDb();
  if (!db) return { error: "not_configured" as const };
  return applyRestaurantZones(db, aoa);
}

export async function loadZoneStaff() {
  const auth = await requireMutationAuth("zones.manage");
  if ("error" in auth) return auth;
  const db = await staffDb();
  if (!db) return { error: "not_configured" as const };
  return listZoneStaff(db);
}

export async function assignStaffZones(userId: string, zoneIds: string[]) {
  const auth = await requireMutationAuth("zones.manage");
  if ("error" in auth) return auth;
  const db = await staffDb();
  if (!db) return { error: "not_configured" as const };
  await saveStaffZones(db, userId, zoneIds);
  return { ok: true as const };
}

export async function loadRosterThresholds() {
  const gate = await viewDb();
  if ("error" in gate) return gate;
  return readRosterSettings(gate.db);
}

export async function saveRosterThresholds(input: {
  lateGraceMinutes: number;
  earlyGraceMinutes: number;
  nearMeters: number;
  minMinutes: number;
  flagMissingProof: boolean;
}) {
  const gate = await manageDb();
  if ("error" in gate) return gate;
  await writeRosterSettings(gate.db, input);
  return { ok: true as const };
}

export async function fetchRosterLive() {
  const gate = await viewDb();
  if ("error" in gate) return gate;
  return loadRosterLive(gate.db, gate.scope);
}

export async function fetchRosterAlerts() {
  const gate = await viewDb();
  if ("error" in gate) return gate;
  const day = kuwaitToday();
  await sweepRosterDay(gate.db, day);
  return { day, rows: await listRosterAlerts(gate.db, gate.scope, day) };
}

export async function fetchDriverRosterWeek(driverId: string) {
  const gate = await viewDb();
  if ("error" in gate) return gate;
  return { days: await loadDriverRoster(gate.db, driverId) };
}

export async function fetchRosterReport(filter: {
  from: string;
  to: string;
  zoneId?: string | null;
  restaurantId?: string | null;
  company?: string | null;
  driverId?: string | null;
}) {
  const gate = await viewDb();
  if ("error" in gate) return gate;
  return loadRosterReport(gate.db, gate.scope, filter);
}
