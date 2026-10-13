"use server";

import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import type { DocumentData, Firestore, Query } from "firebase-admin/firestore";
import {
  WRONG_ACTION_SEVERITIES,
  WRONG_ACTION_TYPES,
  type WrongActionRow,
  type WrongActionSeverity,
  type WrongActionType,
} from "./types";

export type WrongActionDriverOption = {
  id: string;
  full_name: string;
  driver_code: string;
  employee_id: string | null;
  zone_name: string | null;
};

type Row = Record<string, unknown> & { id: string };

function plainValue(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if ("toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (Array.isArray(value)) return value.map(plainValue);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = plainValue(child);
  }
  return out;
}

function asRow(id: string, data: DocumentData | undefined): Row {
  return { id, ...((plainValue(data ?? {}) as Record<string, unknown>) ?? {}) };
}

async function openDb(): Promise<Firestore> {
  const db = await staffDb();
  if (!db) throw new Error("not_configured");
  return db;
}

async function rowsByIds(db: Firestore, collection: string, ids: string[]): Promise<Map<string, Row>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, Row>();
  for (let i = 0; i < unique.length; i += 100) {
    const refs = unique.slice(i, i + 100).map((id) => db.collection(collection).doc(id));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (snap.exists) map.set(snap.id, asRow(snap.id, snap.data()));
    }
  }
  return map;
}

async function queryRows(query: Query): Promise<Row[]> {
  const snap = await query.get();
  return snap.docs.map((doc) => asRow(doc.id, doc.data()));
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function requireWrongActions(permission: "wrong_actions.view" | "wrong_actions.manage") {
  const session = await getSessionUser();
  if (!session || !hasPermissionInSet(session.permissions, permission, session.isSuperAdmin)) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

type DriverJoin = {
  id: string;
  driver_code: string | null;
  profiles: { full_name: string | null } | { full_name: string | null }[] | null;
  zones: { name: string | null } | { name: string | null }[] | null;
};

function mapRow(
  row: Record<string, unknown>,
  authorNames: Map<string, string>,
): WrongActionRow {
  const driver = firstOf(row.drivers as DriverJoin | DriverJoin[] | null);
  const profile = firstOf(driver?.profiles ?? null);
  const zone = firstOf(driver?.zones ?? null);
  const createdBy = (row.created_by as string | null) ?? null;
  return {
    id: row.id as string,
    driver_id: row.driver_id as string,
    action_type: row.action_type as WrongActionType,
    severity: row.severity as WrongActionSeverity,
    details: (row.details as string | null) ?? null,
    occurred_at: row.occurred_at as string,
    source: row.source as WrongActionRow["source"],
    created_at: row.created_at as string,
    created_by: createdBy,
    driver_name: profile?.full_name ?? null,
    driver_code: driver?.driver_code ?? null,
    driver_zone_name: zone?.name ?? null,
    created_by_name: createdBy ? (authorNames.get(createdBy) ?? null) : null,
  };
}

async function attachDrivers(db: Firestore, rows: Row[]): Promise<Record<string, unknown>[]> {
  const driverIds = rows.map((row) => str(row.driver_id)).filter(Boolean);
  const drivers = await rowsByIds(db, COLLECTIONS.drivers, driverIds);
  const profiles = await rowsByIds(db, COLLECTIONS.profiles, [...drivers.keys()]);
  const zones = await rowsByIds(
    db,
    COLLECTIONS.zones,
    [...drivers.values()].map((driver) => str(driver.zone_id)).filter(Boolean),
  );
  const joined: Record<string, unknown>[] = [];
  for (const row of rows) {
    const driver = drivers.get(str(row.driver_id));
    if (!driver) continue;
    const profile = profiles.get(driver.id);
    const zone = zones.get(str(driver.zone_id));
    joined.push({
      ...row,
      drivers: {
        id: driver.id,
        driver_code: str(driver.driver_code) || null,
        profiles: { full_name: str(profile?.full_name) || null },
        zones: zone ? { name: str(zone.name) || null } : null,
      },
    });
  }
  return joined;
}

async function resolveAuthorNames(db: Firestore, rows: Array<{ created_by?: string | null }>) {
  const ids = Array.from(
    new Set(rows.map((row) => row.created_by).filter((id): id is string => Boolean(id))),
  );
  if (ids.length === 0) return new Map<string, string>();
  const profiles = await rowsByIds(db, COLLECTIONS.profiles, ids);
  return new Map(
    [...profiles.values()]
      .filter((row) => str(row.full_name))
      .map((row) => [row.id, str(row.full_name)]),
  );
}

export async function listWrongActions(): Promise<WrongActionRow[]> {
  const auth = await requireWrongActions("wrong_actions.view");
  if ("error" in auth) throw new Error(auth.error);

  const db = await openDb();
  const rows = await queryRows(
    db.collection(COLLECTIONS.wrongActions).orderBy("occurred_at", "desc").limit(2000),
  );
  const joined = await attachDrivers(db, rows);
  const authorNames = await resolveAuthorNames(
    db,
    joined as Array<{ created_by?: string | null }>,
  );

  void logAdminRead("wrong_actions", "/wrong-actions");
  return joined.map((row) => mapRow(row, authorNames));
}

export async function listWrongActionsForDriver(driverId: string): Promise<WrongActionRow[]> {
  const auth = await requireWrongActions("wrong_actions.view");
  if ("error" in auth) throw new Error(auth.error);
  if (!driverId) return [];

  const db = await openDb();
  const rows = (
    await queryRows(db.collection(COLLECTIONS.wrongActions).where("driver_id", "==", driverId))
  )
    .sort((a, b) => str(b.occurred_at).localeCompare(str(a.occurred_at)))
    .slice(0, 500);
  const joined = await attachDrivers(db, rows);
  const authorNames = await resolveAuthorNames(
    db,
    joined as Array<{ created_by?: string | null }>,
  );
  return joined.map((row) => mapRow(row, authorNames));
}

export async function getWrongAction(id: string): Promise<WrongActionRow | null> {
  const auth = await requireWrongActions("wrong_actions.view");
  if ("error" in auth) throw new Error(auth.error);

  const db = await openDb();
  const snap = await db.collection(COLLECTIONS.wrongActions).doc(id).get();
  if (!snap.exists) return null;
  const joined = await attachDrivers(db, [asRow(snap.id, snap.data())]);
  const row = joined[0];
  if (!row) return null;
  const authorNames = await resolveAuthorNames(db, [row as { created_by?: string | null }]);
  return mapRow(row, authorNames);
}

export async function listWrongActionDriverOptions(): Promise<WrongActionDriverOption[]> {
  const auth = await requireWrongActions("wrong_actions.view");
  if ("error" in auth) throw new Error(auth.error);

  const db = await openDb();
  const drivers = (
    await queryRows(db.collection(COLLECTIONS.drivers).where("archived_at", "==", null))
  ).sort((a, b) => str(a.driver_code).localeCompare(str(b.driver_code)));
  const profiles = await rowsByIds(db, COLLECTIONS.profiles, drivers.map((row) => row.id));
  const zones = await rowsByIds(
    db,
    COLLECTIONS.zones,
    drivers.map((row) => str(row.zone_id)).filter(Boolean),
  );

  return drivers.map((row) => ({
    id: row.id,
    full_name: str(profiles.get(row.id)?.full_name) || str(row.driver_code) || "—",
    driver_code: str(row.driver_code),
    employee_id: str(row.employee_id) || null,
    zone_name: str(zones.get(str(row.zone_id))?.name) || null,
  }));
}

function parseIncident(formData: FormData) {
  const driverId = String(formData.get("driverId") ?? "").trim();
  const actionType = String(formData.get("actionType") ?? "").trim();
  const severity = String(formData.get("severity") ?? "").trim();
  const details = String(formData.get("details") ?? "").trim();
  const occurredAt = String(formData.get("occurredAt") ?? "").trim();

  if (!driverId || !occurredAt) return { error: "missing_fields" as const };
  if (!(WRONG_ACTION_TYPES as readonly string[]).includes(actionType)) {
    return { error: "invalid_type" as const };
  }
  if (!(WRONG_ACTION_SEVERITIES as readonly string[]).includes(severity)) {
    return { error: "invalid_severity" as const };
  }

  const occurred = new Date(occurredAt);
  if (Number.isNaN(occurred.getTime())) return { error: "invalid_date" as const };
  if (occurred.getTime() > Date.now()) return { error: "future_date" as const };

  return {
    driver_id: driverId,
    action_type: actionType as WrongActionType,
    severity: severity as WrongActionSeverity,
    details: details || null,
    occurred_at: occurred.toISOString(),
  };
}

export async function saveWrongAction(
  formData: FormData,
): Promise<{ error?: string; id?: string }> {
  const auth = await requireWrongActions("wrong_actions.manage");
  if ("error" in auth) return auth;

  const parsed = parseIncident(formData);
  if ("error" in parsed) return parsed;

  const payload = {
    driver_id: parsed.driver_id,
    action_type: parsed.action_type,
    severity: parsed.severity,
    details: parsed.details,
    occurred_at: new Date(parsed.occurred_at),
  };

  const id = String(formData.get("id") ?? "").trim();
  const db = await openDb();

  if (id) {
    const beforeSnap = await db.collection(COLLECTIONS.wrongActions).doc(id).get();
    const before = beforeSnap.exists ? asRow(beforeSnap.id, beforeSnap.data()) : null;
    try {
      await db.collection(COLLECTIONS.wrongActions).doc(id).set(
        { ...payload, updated_at: new Date() },
        { merge: true },
      );
    } catch (error) {
      return { error: error instanceof Error ? error.message : "save_failed" };
    }

    void logAdminMutation({
      action: "update",
      entityType: "wrong_action",
      entityId: id,
      routeName: "/wrong-actions",
      before: before
        ? {
            driver_id: before.driver_id,
            action_type: before.action_type,
            severity: before.severity,
            details: before.details,
            occurred_at: before.occurred_at,
          }
        : undefined,
      after: { ...payload, occurred_at: parsed.occurred_at },
    });
    return { id };
  }

  const createdId = crypto.randomUUID();
  try {
    await db.collection(COLLECTIONS.wrongActions).doc(createdId).set({
      id: createdId,
      ...payload,
      source: "admin",
      created_by: auth.session.id,
      created_at: new Date(),
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "save_failed" };
  }

  void logAdminMutation({
    action: "create",
    entityType: "wrong_action",
    entityId: createdId,
    routeName: "/wrong-actions",
    after: { ...payload, occurred_at: parsed.occurred_at, source: "admin" },
  });
  return { id: createdId };
}

export async function deleteWrongAction(id: string): Promise<{ error?: string }> {
  const auth = await requireWrongActions("wrong_actions.manage");
  if ("error" in auth) return auth;
  if (!id) return { error: "missing_fields" };

  const db = await openDb();
  const beforeSnap = await db.collection(COLLECTIONS.wrongActions).doc(id).get();
  const before = beforeSnap.exists ? asRow(beforeSnap.id, beforeSnap.data()) : null;
  try {
    await db.collection(COLLECTIONS.wrongActions).doc(id).delete();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "save_failed" };
  }

  void logAdminMutation({
    action: "delete",
    entityType: "wrong_action",
    entityId: id,
    routeName: "/wrong-actions",
    before: before
      ? {
          driver_id: before.driver_id,
          action_type: before.action_type,
          severity: before.severity,
          details: before.details,
          occurred_at: before.occurred_at,
          source: before.source,
        }
      : undefined,
  });
  return {};
}
