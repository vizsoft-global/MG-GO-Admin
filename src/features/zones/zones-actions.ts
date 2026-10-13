"use server";

import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet, type Permission } from "@/lib/auth/permissions";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import {
  suggestZoneCode,
  validateZoneGeometry,
  type ZoneGeoFeature,
  type ZoneGeometryType,
} from "@/lib/geo/zone-geometry";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { DEFAULT_GEOFENCE_SETTINGS } from "./geofence-defaults";
import { mapZoneDbError } from "./zone-errors";
import { normalizeZoneColor } from "./zone-colors";
import type { ZoneGeofenceSettings } from "./types";

export type ZoneGeofenceInput = ZoneGeofenceSettings;

const SETTINGS_COLLECTION = "zone_geofence_settings";
const GEOFENCE_EVENTS = "geofence_events";

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

function geofenceSettingsPayload(settings: ZoneGeofenceInput) {
  return {
    geofence_kind: settings.geofence_kind,
    status: settings.status,
    description: settings.description?.trim() || null,
    alert_on_entry: settings.alert_on_entry,
    alert_on_exit: settings.alert_on_exit,
    alert_on_dwell: settings.alert_on_dwell,
    dwell_time_seconds: settings.dwell_time_seconds,
    assign_to_all_drivers: settings.assign_to_all_drivers,
    driver_group_label: settings.driver_group_label?.trim() || null,
    notify_in_app: settings.notify_in_app,
    notify_email: settings.notify_email,
    notify_sms: settings.notify_sms,
    updated_at: new Date().toISOString(),
  };
}

async function upsertZoneGeofenceSettings(
  db: Firestore,
  zoneId: string,
  settings: ZoneGeofenceInput,
) {
  await db
    .collection(SETTINGS_COLLECTION)
    .doc(zoneId)
    .set({ zone_id: zoneId, ...geofenceSettingsPayload(settings) }, { merge: true });
}

async function zoneCodeTaken(db: Firestore, code: string, exceptId?: string): Promise<boolean> {
  const snap = await db.collection(COLLECTIONS.zones).where("code", "==", code).get();
  return snap.docs.some((doc) => doc.id !== exceptId);
}

async function requireZonesManager(verb: "create" | "edit" | "delete" = "edit") {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, `zones.${verb}` as Permission, session.isSuperAdmin)
  ) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

export type ZoneMutationResult = { error?: string; success?: boolean; id?: string };

export async function createZone(input: {
  name: string;
  code: string;
  color: string;
  zone_type: ZoneGeometryType;
  geometry: ZoneGeoFeature;
  geofence?: Partial<ZoneGeofenceInput>;
}): Promise<ZoneMutationResult> {
  const auth = await requireZonesManager("create");
  if ("error" in auth) return auth;

  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();
  if (!name || !code) return { error: "missing_fields" };

  const geometryError = validateZoneGeometry(input.zone_type, input.geometry);
  if (geometryError) return { error: geometryError };

  const db = await openDb();
  if (await zoneCodeTaken(db, code)) return { error: mapZoneDbError({ code: "23505" }) };

  const id = crypto.randomUUID();
  try {
    await db.collection(COLLECTIONS.zones).doc(id).set({
      id,
      name,
      code,
      color: normalizeZoneColor(input.color),
      zone_type: input.zone_type,
      geometry: input.geometry,
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    return { error: mapZoneDbError(error as { message: string }) };
  }

  const geofence: ZoneGeofenceInput = {
    ...DEFAULT_GEOFENCE_SETTINGS,
    ...(input.geofence ?? {}),
  };

  try {
    await upsertZoneGeofenceSettings(db, id, geofence);
  } catch (settingsError) {
    await db.collection(COLLECTIONS.zones).doc(id).delete();
    return { error: mapZoneDbError(settingsError as { message: string }) };
  }

  void logAdminMutation({
    action: "create",
    entityType: "zone",
    entityId: id,
    routeName: "createZone",
    after: {
      name,
      code,
      geofence_kind: geofence.geofence_kind,
      alert_on_entry: geofence.alert_on_entry,
      alert_on_exit: geofence.alert_on_exit,
    },
  });

  return { success: true, id };
}

export async function updateZone(input: {
  id: string;
  name: string;
  code: string;
  color: string;
  zone_type: ZoneGeometryType;
  geometry: ZoneGeoFeature;
  geofence?: Partial<ZoneGeofenceInput>;
}): Promise<ZoneMutationResult> {
  const auth = await requireZonesManager("edit");
  if ("error" in auth) return auth;

  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();
  if (!name || !code) return { error: "missing_fields" };

  const geometryError = validateZoneGeometry(input.zone_type, input.geometry);
  if (geometryError) return { error: geometryError };

  const db = await openDb();
  const existingSnap = await db.collection(COLLECTIONS.zones).doc(input.id).get();
  if (!existingSnap.exists) {
    return { error: mapZoneDbError({ message: "not_found" }) };
  }
  const existing = asRow(existingSnap.id, existingSnap.data());
  if (await zoneCodeTaken(db, code, input.id)) {
    return { error: mapZoneDbError({ code: "23505" }) };
  }

  const next = {
    name,
    code,
    color: normalizeZoneColor(input.color),
    zone_type: input.zone_type,
    geometry: input.geometry,
    updated_at: new Date().toISOString(),
  };

  try {
    await db.collection(COLLECTIONS.zones).doc(input.id).set(next, { merge: true });
  } catch (error) {
    return { error: mapZoneDbError(error as { message: string }) };
  }

  const geofence: ZoneGeofenceInput = {
    ...DEFAULT_GEOFENCE_SETTINGS,
    ...(input.geofence ?? {}),
  };

  try {
    await upsertZoneGeofenceSettings(db, input.id, geofence);
  } catch (settingsError) {
    await db.collection(COLLECTIONS.zones).doc(input.id).set(
      {
        name: existing.name,
        code: existing.code,
        color: existing.color,
        zone_type: existing.zone_type,
        geometry: existing.geometry,
        updated_at: new Date().toISOString(),
      },
      { merge: true },
    );
    return { error: mapZoneDbError(settingsError as { message: string }) };
  }

  void logAdminMutation({
    action: "update",
    entityType: "zone",
    entityId: input.id,
    routeName: "updateZone",
    after: {
      name,
      code,
      geofence_kind: geofence.geofence_kind,
      status: geofence.status,
    },
  });

  return { success: true, id: input.id };
}

async function clearZoneLinks(db: Firestore, zoneId: string) {
  const drivers = await db.collection(COLLECTIONS.drivers).where("zone_id", "==", zoneId).get();
  let batch = db.batch();
  let pending = 0;
  for (const doc of drivers.docs) {
    batch.update(doc.ref, { zone_id: null });
    pending += 1;
    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();

  const events = await db.collection(GEOFENCE_EVENTS).where("zone_id", "==", zoneId).get();
  let eventBatch = db.batch();
  let eventPending = 0;
  for (const doc of events.docs) {
    eventBatch.delete(doc.ref);
    eventPending += 1;
    if (eventPending >= 400) {
      await eventBatch.commit();
      eventBatch = db.batch();
      eventPending = 0;
    }
  }
  if (eventPending > 0) await eventBatch.commit();
  await db.collection(SETTINGS_COLLECTION).doc(zoneId).delete();
}

export async function deleteZone(id: string, force = false): Promise<ZoneMutationResult> {
  const auth = await requireZonesManager("delete");
  if ("error" in auth) return auth;

  const db = await openDb();
  const countSnap = await db.collection(COLLECTIONS.drivers).where("zone_id", "==", id).count().get();
  const count = countSnap.data().count;

  if (!force && count > 0) return { error: "has_drivers" };

  if (force && count > 0) {
    try {
      const drivers = await db.collection(COLLECTIONS.drivers).where("zone_id", "==", id).get();
      let batch = db.batch();
      let pending = 0;
      for (const doc of drivers.docs) {
        batch.update(doc.ref, { zone_id: null });
        pending += 1;
        if (pending >= 400) {
          await batch.commit();
          batch = db.batch();
          pending = 0;
        }
      }
      if (pending > 0) await batch.commit();
    } catch (error) {
      return { error: mapZoneDbError(error as { message: string }) };
    }
  }

  try {
    await clearZoneLinks(db, id);
    await db.collection(COLLECTIONS.zones).doc(id).delete();
  } catch (error) {
    return { error: mapZoneDbError(error as { message: string }) };
  }

  void logAdminMutation({
    action: "delete",
    entityType: "zone",
    entityId: id,
    routeName: "deleteZone",
    context: { force },
  });

  return { success: true };
}

export async function generateZoneCode(): Promise<{ code: string }> {
  return { code: suggestZoneCode() };
}
