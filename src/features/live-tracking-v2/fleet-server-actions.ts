"use server";

import type { DocumentData, Firestore } from "firebase-admin/firestore";

import { callAdminFunction } from "@/lib/firebase/callable";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { fetchEdgeHistory, type EdgeArchivePoint } from "@/lib/fleet/edge-read";
import { gpsR2Since } from "@/lib/fleet/gps-cutover";

import { buildDayRouteTrack, mergeArchivePoints } from "./day-route-build";
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

/** The rider's shift, when the panel knows it. A night shift can end on the next Kuwait day. */
export type DayRouteWindow = { from: string; to: string };

function kuwaitDayOf(ms: number): string {
  return new Date(ms + 3 * 3600_000).toISOString().slice(0, 10);
}

/** Kuwait calendar days touched by a window. A shift is at most two days wide. */
function windowDays(fromIso: string, toIso: string): string[] {
  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) return [];
  const days: string[] = [];
  for (let ms = fromMs; ms <= toMs && days.length < 2; ms += 86_400_000) {
    const day = kuwaitDayOf(ms);
    if (!days.includes(day)) days.push(day);
  }
  const last = kuwaitDayOf(toMs);
  if (!days.includes(last) && days.length < 2) days.push(last);
  return days;
}

/**
 * Archive points for the route. A shift that crosses Kuwait midnight is stored in
 * two day objects, so both are read and merged inside `[from, to]`; without a
 * window the route stays one calendar day (00:00–24:00 Kuwait).
 */
async function edgeDayTrack(driverId: string, date: string, window?: DayRouteWindow) {
  const db = await staffDb();
  if (!db) return null;
  const since = await gpsR2Since(db);
  if (!since) return null;

  const fromMs = window ? Date.parse(window.from) : Date.parse(`${date}T00:00:00+03:00`);
  const toMs = window ? Date.parse(window.to) : Date.parse(`${date}T23:59:59.999+03:00`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) return null;

  const days = (window ? windowDays(window.from, window.to) : [date]).filter(
    (day) => day >= since,
  );
  if (days.length === 0) return null;

  const histories = await Promise.all(days.map((day) => fetchEdgeHistory(driverId, day, false)));
  const pointsByDay: EdgeArchivePoint[][] = [];
  for (const history of histories) {
    // A day outside the hot window needs an explicit archive read; the day route
    // does not pay that fee, so it falls back to the stored day route instead.
    if (history.kind !== "ok") return null;
    pointsByDay.push(history.history.points);
  }

  const points = mergeArchivePoints(pointsByDay, fromMs, toMs);
  if (points.length === 0) return null;
  return buildDayRouteTrack(points);
}

export async function fetchDriverDayRoute(driverId: string, date: string, window?: DayRouteWindow) {
  const track = await edgeDayTrack(driverId, date, window).catch(() => null);
  const response = await callAdminFunction<DayRouteResponse>("admin_get_driver_day_route", {
    driverId,
    date,
    ...(window ? { from: window.from, to: window.to } : {}),
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
