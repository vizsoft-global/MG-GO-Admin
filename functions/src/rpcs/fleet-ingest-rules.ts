/**
 * Pure batch rules for the edge hub's durable flush.
 *
 * The numbers match `driver-location.ts`: 15s / 18m coalesce (the interval comes
 * from settings and defaults to 15), 50m coarse and 40 m/s and 500m gap inside
 * `odometerSegmentMeters`, plus the SQL extra that a zone-status change is never
 * coalesced. Pin defer stays in the room; this file only decides what a flush may write.
 */
import { shouldCoalesceLocation } from "./driver-location";

export const PIN_WRITE_MIN_MS = 1000;
const HISTORY_CLAMP_MS = 15 * 60 * 1000;
const CLIENT_FUTURE_MS = 5 * 60 * 1000;
const CLIENT_PAST_MS = 7 * 24 * 60 * 60 * 1000;
const INGEST_BATCH_MAX = 5000;
const EVENT_BATCH_MAX = 2000;

const TRACKING_STATUSES = new Set(["idle", "moving", "delivery_submit"]);
const SEVERITIES = new Set(["info", "warning", "critical"]);

export type IngestPoint = {
  driverId: string;
  lat: number;
  lng: number;
  speedMps: number | null;
  accuracyM: number | null;
  headingDeg: number | null;
  batteryPct: number | null;
  altitudeM: number | null;
  networkType: string | null;
  chargingState: string | null;
  isMocked: boolean | null;
  locationProvider: string | null;
  activeDeliveryId: string | null;
  deliveryId: string | null;
  trackingStatus: "idle" | "moving" | "delivery_submit";
  clientTs: Date;
  replay: boolean;
  ord: number;
};

export type FleetEventDraft = {
  driverId: string;
  eventKey: string;
  severity: "info" | "warning" | "critical";
  statusBefore: string | null;
  statusAfter: string | null;
  value: number | null;
  zoneId: string | null;
  latitude: number | null;
  longitude: number | null;
  context: Record<string, unknown>;
  detectedAt: Date;
  source: string;
};

export type IngestParse =
  | { ok: false; error: "events_array_required" | "batch_too_large"; received?: number }
  | { ok: true; received: number; points: IngestPoint[] };

export type FleetEventParse =
  | { ok: false; error: "events_array_required" | "batch_too_large"; received?: number }
  | { ok: true; received: number; events: FleetEventDraft[] };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function asBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function asDict(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** One `driver_locations/{uid}` write per second, measured on `updated_at`. */
export function pinWriteAllowed(lastWriteAtMs: number | null, nowMs: number): boolean {
  if (lastWriteAtMs == null || !Number.isFinite(lastWriteAtMs)) return true;
  return nowMs - lastWriteAtMs >= PIN_WRITE_MIN_MS;
}

/** `GREATEST(LEAST(client_ts, now), now - 15 minutes)`. Replay history does not use this. */
export function clampHistoryRecordedAt(clientTs: Date, now: Date): Date {
  const capped = Math.min(clientTs.getTime(), now.getTime());
  return new Date(Math.max(capped, now.getTime() - HISTORY_CLAMP_MS));
}

export function shouldCoalesceIngestPin(args: {
  prev: { lastSeenAt: Date; lat: number; lng: number; trackingStatus: string | null } | null;
  now: Date;
  lat: number;
  lng: number;
  status: string;
  minIntervalSeconds: number;
  prevZoneStatus: string | null;
  zoneStatus: string;
}): boolean {
  if (args.prevZoneStatus !== args.zoneStatus) return false;
  return shouldCoalesceLocation({
    prev: args.prev,
    now: args.now,
    lat: args.lat,
    lng: args.lng,
    status: args.status,
    minIntervalSeconds: args.minIntervalSeconds,
  });
}

export function sortIngestPoints(points: readonly IngestPoint[]): IngestPoint[] {
  return [...points].sort((a, b) => {
    if (a.driverId !== b.driverId) return a.driverId < b.driverId ? -1 : 1;
    if (a.replay !== b.replay) return a.replay ? 1 : -1;
    const at = a.clientTs.getTime() - b.clientTs.getTime();
    if (at !== 0) return at;
    return a.ord - b.ord;
  });
}

export function parseIngestBatch(raw: unknown, now: Date): IngestParse {
  if (!Array.isArray(raw)) return { ok: false, error: "events_array_required" };
  if (raw.length > INGEST_BATCH_MAX) {
    return { ok: false, error: "batch_too_large", received: raw.length };
  }
  const points: IngestPoint[] = [];
  raw.forEach((item, ord) => {
    const row = asDict(item);
    if (!row) return;
    const driverId = text(row.driver_id);
    const lat = num(row.lat);
    const lng = num(row.lng);
    if (!driverId || driverId.includes("/") || lat === null || lng === null) return;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
    const status = (text(row.tracking_status) ?? "idle").toLowerCase();
    if (!TRACKING_STATUSES.has(status)) return;
    const clientTs = asDate(row.client_ts) ?? now;
    if (clientTs.getTime() > now.getTime() + CLIENT_FUTURE_MS) return;
    if (clientTs.getTime() < now.getTime() - CLIENT_PAST_MS) return;
    points.push({
      driverId,
      lat,
      lng,
      speedMps: num(row.speed_mps),
      accuracyM: num(row.accuracy_m) ?? num(row.accuracy_meters),
      headingDeg: num(row.heading_deg),
      batteryPct: num(row.battery_pct),
      altitudeM: num(row.altitude_m),
      networkType: text(row.network_type),
      chargingState: text(row.charging_state),
      isMocked: asBool(row.is_mocked),
      locationProvider: text(row.location_provider),
      activeDeliveryId: text(row.active_delivery_id),
      deliveryId: text(row.delivery_id),
      trackingStatus: status as IngestPoint["trackingStatus"],
      clientTs,
      replay: row.replay === true || row.replay === "true",
      ord,
    });
  });
  return { ok: true, received: raw.length, points };
}

export function parseFleetEventBatch(raw: unknown, now: Date): FleetEventParse {
  if (!Array.isArray(raw)) return { ok: false, error: "events_array_required" };
  if (raw.length > EVENT_BATCH_MAX) {
    return { ok: false, error: "batch_too_large", received: raw.length };
  }
  const events: FleetEventDraft[] = [];
  for (const item of raw) {
    const row = asDict(item);
    if (!row) continue;
    const driverId = text(row.driver_id);
    const eventKey = text(row.event_key);
    if (!driverId || driverId.includes("/") || !eventKey) continue;
    const severityRaw = (text(row.severity) ?? "info").toLowerCase();
    const severity = SEVERITIES.has(severityRaw)
      ? (severityRaw as FleetEventDraft["severity"])
      : "info";
    const detected = asDate(row.detected_at) ?? now;
    events.push({
      driverId,
      eventKey,
      severity,
      statusBefore: text(row.status_before),
      statusAfter: text(row.status_after),
      value: num(row.value),
      zoneId: text(row.zone_id),
      latitude: num(row.latitude),
      longitude: num(row.longitude),
      context: asDict(row.context) ?? {},
      detectedAt: detected.getTime() > now.getTime() ? now : detected,
      source: text(row.source) ?? "edge",
    });
  }
  return { ok: true, received: raw.length, events };
}
