import "server-only";

import { signFleetToken } from "@/features/live-tracking-v2/fleet-token";

const EDGE_TIMEOUT_MS = 2_500;

export type EdgePin = {
  driver_id: string;
  lat: number;
  lng: number;
  recorded_at: string;
  speed_mps: number | null;
  heading_deg: number | null;
  accuracy_meters: number | null;
  battery_pct: number | null;
  is_mocked: boolean;
  tracking_status: string;
  active_delivery_id: string | null;
  status: string;
  is_on_duty: boolean;
  is_online: boolean;
  location_off: boolean;
  range_status: string | null;
  distance_today_m: number | null;
};

export type EdgeLatest = { generated_at: string; drivers: EdgePin[] };

export type EdgeFleetStats = {
  generated_at: string;
  drivers: number;
  with_fix: number;
  live: number;
  on_duty: number;
  out_of_zone?: number;
  by_status: Record<string, number>;
};

/** Compact archive point, as written by the FleetRoom (`gps-archive.ts`). */
export type EdgeArchivePoint = {
  t: number;
  la: number;
  lo: number;
  s: number | null;
  a: number | null;
  h: number | null;
  b: number | null;
  m: 0 | 1;
  st: string;
  d: string | null;
  ad: string | null;
  r: 0 | 1;
};

export type EdgeDayStats = {
  movingS: number;
  idleS: number;
  dwellS: number;
  outOfZoneS: number;
  mockedCount: number;
  points: number;
  distanceM: number;
};

export type EdgeHistory = {
  driver_id: string;
  day: string;
  stats: EdgeDayStats | null;
  points: EdgeArchivePoint[];
};

export type EdgeHistoryDay = {
  day: string;
  points: number;
  distance_m: number;
  first_ts: number | null;
  last_ts: number | null;
  archived: boolean;
};

export type EdgeHistoryResult =
  | { kind: "ok"; history: EdgeHistory }
  | { kind: "archive_required" }
  | { kind: "unavailable" };

function edgeBase(): string | null {
  const base = process.env.FLEET_WS_URL?.trim();
  if (!base || !process.env.FLEET_WS_TOKEN_SECRET?.trim()) return null;
  return base.replace(/\/+$/, "").replace(/^ws(s?):/i, "http$1:");
}

async function edgeGet(path: string, params: Record<string, string> = {}): Promise<Response | null> {
  const base = edgeBase();
  const secret = process.env.FLEET_WS_TOKEN_SECRET?.trim();
  if (!base || !secret) return null;
  try {
    const token = await signFleetToken(secret, {
      sub: "admin-server",
      room: process.env.FLEET_ROOM?.trim() || "fleet-kw",
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(EDGE_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
}

async function edgeJson<T>(path: string, params?: Record<string, string>): Promise<T | null> {
  const response = await edgeGet(path, params);
  if (!response?.ok) return null;
  try {
    const body = (await response.json()) as T & { ok?: boolean };
    return body.ok === false ? null : body;
  } catch {
    return null;
  }
}

/** Live pins from the FleetRoom, or null so the caller falls back to Firestore. */
export function fetchEdgeLatest(driverId?: string): Promise<EdgeLatest | null> {
  return edgeJson<EdgeLatest>("/latest", driverId ? { driver: driverId } : undefined);
}

export function fetchEdgeFleetStats(): Promise<EdgeFleetStats | null> {
  return edgeJson<EdgeFleetStats>("/fleet-stats");
}

export async function fetchEdgeHistoryDays(
  driverId: string,
  from?: string,
  to?: string,
): Promise<EdgeHistoryDay[] | null> {
  const params: Record<string, string> = { driver: driverId };
  if (from) params.from = from;
  if (to) params.to = to;
  const body = await edgeJson<{ days: EdgeHistoryDay[] }>("/history/days", params);
  return body?.days ?? null;
}

/** One rider-day from the R2 archive. Days older than 7 need `archive: true` (retrieval fee). */
export async function fetchEdgeHistory(
  driverId: string,
  day: string,
  archive = false,
): Promise<EdgeHistoryResult> {
  const params: Record<string, string> = { driver: driverId, day };
  if (archive) params.archive = "1";
  const response = await edgeGet("/history", params);
  if (!response) return { kind: "unavailable" };
  if (response.status === 409) return { kind: "archive_required" };
  if (!response.ok) return { kind: "unavailable" };
  try {
    const body = (await response.json()) as EdgeHistory & { ok?: boolean };
    return body.ok === false ? { kind: "unavailable" } : { kind: "ok", history: body };
  } catch {
    return { kind: "unavailable" };
  }
}
