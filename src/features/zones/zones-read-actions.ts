"use server";

import { logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import type { ZoneGeoFeature } from "@/lib/geo/zone-geometry";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { normalizeZoneColor } from "./zone-colors";
import { normalizeZoneRow } from "./geofence-defaults";
import type { ZoneDriverRow, ZoneGeofenceSettings, ZoneRow } from "./types";

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

async function rowsByIds(db: Firestore, collection: string, ids: string[]): Promise<Row[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out: Row[] = [];
  for (let i = 0; i < unique.length; i += 100) {
    const refs = unique.slice(i, i + 100).map((id) => db.collection(collection).doc(id));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (snap.exists) out.push(asRow(snap.id, snap.data()));
    }
  }
  return out;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function requireZonesView() {
  const session = await getSessionUser();
  if (!session || !hasPermissionInSet(session.permissions, "zones.view", session.isSuperAdmin)) {
    throw new Error("not_authorized");
  }
  return session;
}

async function requireStaff() {
  const session = await getSessionUser();
  if (!session) throw new Error("not_authorized");
}

export type ZoneAssistantRow = {
  id: string;
  name: string;
  code: string;
};

/** Staff list for assistant — id/name/code only, no geometry. */
export async function listZonesForAssistant(): Promise<ZoneAssistantRow[]> {
  await requireZonesView();
  void logAdminRead("zones", "listZonesForAssistant", {});
  const db = await openDb();
  const snap = await db.collection(COLLECTIONS.zones).get();
  return snap.docs
    .map((doc) => {
      const row = asRow(doc.id, doc.data());
      return { id: row.id, name: str(row.name), code: str(row.code) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const SETTINGS_COLLECTION = "zone_geofence_settings";

export async function loadZonesForPanel(): Promise<ZoneRow[]> {
  await requireStaff();
  const db = await openDb();
  const zonesSnap = await db.collection(COLLECTIONS.zones).get();
  const zones = zonesSnap.docs
    .map((doc) => asRow(doc.id, doc.data()))
    .sort((a, b) => str(a.name).localeCompare(str(b.name)));

  let settingsByZone = new Map<string, Row>();
  try {
    const settings = await rowsByIds(
      db,
      SETTINGS_COLLECTION,
      zones.map((zone) => zone.id),
    );
    settingsByZone = new Map(settings.map((row) => [str(row.zone_id) || row.id, row]));
  } catch {
    settingsByZone = new Map();
  }

  const driversSnap = await db.collection(COLLECTIONS.drivers).select("zone_id").get();
  const countByZone = new Map<string, number>();
  for (const doc of driversSnap.docs) {
    const zoneId = str(doc.data().zone_id);
    if (!zoneId) continue;
    countByZone.set(zoneId, (countByZone.get(zoneId) ?? 0) + 1);
  }

  return zones.map((zone) =>
    normalizeZoneRow(
      {
        id: zone.id,
        name: str(zone.name),
        code: str(zone.code),
        color: normalizeZoneColor(str(zone.color)),
        zone_type: (str(zone.zone_type) || "polygon") as ZoneRow["zone_type"],
        geometry: (zone.geometry ?? null) as ZoneGeoFeature | null,
        created_at: str(zone.created_at),
        zone_geofence_settings: (settingsByZone.get(zone.id) as Partial<ZoneGeofenceSettings> | undefined) ?? null,
      },
      countByZone.get(zone.id) ?? 0,
    ),
  );
}

export async function loadZoneDriversForPanel(zoneId: string): Promise<ZoneDriverRow[]> {
  await requireStaff();
  const db = await openDb();
  const snap = await db.collection(COLLECTIONS.drivers).where("zone_id", "==", zoneId).get();
  const drivers = snap.docs
    .map((doc) => asRow(doc.id, doc.data()))
    .sort((a, b) => str(a.driver_code).localeCompare(str(b.driver_code)));
  if (drivers.length === 0) return [];

  const partnerIds = [...new Set(drivers.map((row) => str(row.partner_id)).filter(Boolean))];
  const [profiles, partners] = await Promise.all([
    rowsByIds(db, COLLECTIONS.profiles, drivers.map((row) => row.id)),
    rowsByIds(db, COLLECTIONS.partners, partnerIds),
  ]);
  const profileMap = new Map(profiles.map((row) => [row.id, str(row.full_name) || null]));
  const partnerMap = new Map(partners.map((row) => [row.id, row]));

  return drivers.map((row) => {
    const partner = str(row.partner_id) ? partnerMap.get(str(row.partner_id)) : undefined;
    return {
      id: row.id,
      driver_code: str(row.driver_code),
      full_name: profileMap.get(row.id) ?? null,
      partner_name: partner ? str(partner.name) || null : null,
      partner_logo_url: partner ? str(partner.logo_url) || null : null,
    };
  });
}
