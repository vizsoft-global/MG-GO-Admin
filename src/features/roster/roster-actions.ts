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
  acknowledgeRosterAlert,
  listRosterDirectory,
  loadRosterAlertDetail,
  loadRosterReport,
  previewRosterImport,
  readRosterSettings,
  saveStaffZones,
  sweepRosterDay,
  writeRosterSettings,
} from "@/features/roster/roster-data";
import { createRosterChange, decideRosterChangeDoc, listRosterChanges, type RosterChangeView } from "@/features/roster/roster-changes";
import { kuwaitToday } from "@/features/driver-tracking/kuwait-time";

function actorName(session: { id: string; email: string | null; profile: { full_name: string | null } }) {
  return session.profile.full_name?.trim() || session.email || session.id;
}

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
  noLoginGraceMinutes: number;
  nearMeters: number;
  minMinutes: number;
  customerMeters: number;
  flagMissingProof: boolean;
  alertOnce: boolean;
  minCoaches: number;
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

export async function fetchRosterAlerts(input?: { day?: string; restaurantId?: string | null }) {
  const gate = await viewDb();
  if ("error" in gate) return gate;
  const day = input?.day || kuwaitToday();
  if (day === kuwaitToday()) await sweepRosterDay(gate.db, day);
  return { day, rows: await listRosterAlerts(gate.db, gate.scope, day, input?.restaurantId ?? null) };
}

export async function fetchRosterDirectory() {
  const gate = await viewDb();
  if ("error" in gate) return gate;
  return listRosterDirectory(gate.db, gate.scope);
}

export async function fetchRosterAlertDetail(id: string) {
  const gate = await viewDb();
  if ("error" in gate) return gate;
  return loadRosterAlertDetail(gate.db, id);
}

export async function ackRosterAlert(id: string, outcome: string) {
  const auth = await requireMutationAuth("attendance.view");
  if ("error" in auth) return auth;
  const db = await staffDb();
  if (!db) return { error: "not_configured" as const };
  return acknowledgeRosterAlert(db, id, auth.session.id, actorName(auth.session), outcome);
}

export async function fetchRosterChanges() {
  const gate = await viewDb();
  if ("error" in gate) return gate;
  const rows = await listRosterChanges(gate.db);
  return {
    rows: gate.scope.all ? rows : rows.filter((row) => row.zoneId != null && gate.scope.zoneIds.includes(row.zoneId)),
  };
}

export async function requestRosterChange(
  input: Omit<RosterChangeView, "id" | "status" | "decidedByName" | "requestedByName">,
) {
  const auth = await requireMutationAuth("attendance.view");
  if ("error" in auth) return auth;
  const db = await staffDb();
  if (!db) return { error: "not_configured" as const };
  return createRosterChange(db, {
    ...input,
    requestedBy: auth.session.id,
    requestedByName: actorName(auth.session),
  });
}

export async function decideRosterChange(id: string, status: "approved" | "rejected") {
  const auth = await requireMutationAuth("attendance.view");
  if ("error" in auth) return auth;
  const allowed = auth.session.isManager || auth.session.isSuperAdmin || auth.session.permissions.has("attendance.manage");
  if (!allowed) return { error: "not_authorized" as const };
  const db = await staffDb();
  if (!db) return { error: "not_configured" as const };
  return decideRosterChangeDoc(db, id, status, auth.session.id, actorName(auth.session));
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
