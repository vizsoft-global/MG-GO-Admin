"use server";

import type { DocumentData, Firestore } from "firebase-admin/firestore";

import { callAdminFunction } from "@/lib/firebase/callable";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { fetchEdgeHistory } from "@/lib/fleet/edge-read";
import { gpsR2Since } from "@/lib/fleet/gps-cutover";

import { buildDayRouteTrack } from "./day-route-build";
import { toFleetZone } from "./fleet-zones";
import type { FleetSnapshotRow } from "./fleet-store";
import type { FleetZone } from "./fleet-types";

type Loose = Record<string, unknown>;

function fromValue(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (Array.isArray(value)) return value.map(fromValue);
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Loose = {};
    for (const [key, inner] of Object.entries(value as Loose)) out[key] = fromValue(inner);
    return out;
  }
  return value;
}

function fromDoc(id: string, data: DocumentData | undefined): Loose {
  const out: Loose = { id };
  for (const [key, value] of Object.entries(data ?? {})) out[key] = fromValue(value);
  if (data?.id != null) out.id = fromValue(data.id) as string;
  return out;
}

type DayRouteResponse = Loose & { distance_source?: string; distance_m?: number };

async function edgeDayTrack(driverId: string, date: string) {
  const db = await staffDb();
  if (!db) return null;
  const since = await gpsR2Since(db);
  if (!since || date < since) return null;
  const result = await fetchEdgeHistory(driverId, date, false);
  if (result.kind !== "ok" || result.history.points.length === 0) return null;
  return buildDayRouteTrack(result.history.points);
}

export async function fetchDriverDayRoute(driverId: string, date: string) {
  const track = await edgeDayTrack(driverId, date).catch(() => null);
  const response = await callAdminFunction<DayRouteResponse>("admin_get_driver_day_route", {
    driverId,
    date,
    skipEvents: track != null,
  });
  if (!track || response.error || !response.data) return response;
  const odometer = response.data.distance_source === "odometer" ? response.data.distance_m : undefined;
  return {
    data: {
      ...response.data,
      ...track,
      distance_m: typeof odometer === "number" ? odometer : track.sampled_distance_m,
      distance_source: typeof odometer === "number" ? "odometer" : "sampled",
    },
    error: null,
  };
}

export async function fetchLiveFleetSnapshot() {
  try {
    return await callAdminFunction<{
      generated_at: string;
      settings: Record<string, number> | null;
      drivers: FleetSnapshotRow[];
    } | null>("admin_live_fleet_snapshot", { p_seen_within_minutes: 30 });
  } catch (error) {
    return {
      data: null,
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export async function fetchFleetEventSeed() {
  try {
    return await callAdminFunction<{ events?: Array<Record<string, unknown>> } | null>(
      "admin_list_fleet_events",
      { p_limit: 50 },
    );
  } catch (error) {
    return {
      data: null,
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export async function fetchFleetZones(): Promise<FleetZone[]> {
  const db = await staffDb();
  if (!db) return [];
  try {
    const snap = await db.collection(COLLECTIONS.zones).get();
    const zones: FleetZone[] = [];
    for (const doc of snap.docs) {
      const data = fromDoc(doc.id, doc.data());
      const zone = toFleetZone({
        id: String(data.id ?? doc.id),
        name: (data.name as string | null) ?? null,
        color: (data.color as string | null) ?? null,
        zone_type: (data.zone_type as string | null) ?? null,
        geometry: data.geometry,
      });
      if (zone) zones.push(zone);
    }
    return zones;
  } catch {
    return [];
  }
}

async function readOps(db: Firestore): Promise<Loose[]> {
  const collection = db.collection(COLLECTIONS.driverOperationEvents);
  try {
    const snap = await collection.orderBy("id", "desc").limit(50).get();
    return snap.docs.map((doc) => fromDoc(doc.id, doc.data()));
  } catch {
    const snap = await collection.orderBy("occurred_at", "desc").limit(50).get();
    return snap.docs.map((doc) => fromDoc(doc.id, doc.data()));
  }
}

export async function fetchFleetOpsSeed(): Promise<Loose[]> {
  const db = await staffDb();
  if (!db) return [];
  try {
    return await readOps(db);
  } catch {
    return [];
  }
}
