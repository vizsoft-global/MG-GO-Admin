import { Timestamp } from "./fs";

/**
 * Firestore TTL deletes a row once `expire_at` passes, so the purge crons no
 * longer read each row before deleting it. TTL removes rows within ~24h of the
 * stamp, never before it.
 */
export const EXPIRE_AT_FIELD = "expire_at";

export const EVENT_RETENTION_DAYS = {
  driver_operation_events: 30,
  driver_location_events: 90,
  driver_telemetry_events: 7,
} as const;

/**
 * Location history drops to 7 days only once R2 holds it (`location_gps_r2_since`
 * set, Worker at GPS_SINK_PERCENT=100); until then Firestore is the only copy.
 */
export const LOCATION_ARCHIVED_RETENTION_DAYS = 7;

export type EventStream = keyof typeof EVENT_RETENTION_DAYS;

export function retentionDays(stream: EventStream, env: NodeJS.ProcessEnv = process.env): number {
  if (stream === "driver_location_events" && env.LOCATION_EVENTS_ARCHIVED === "1") {
    return LOCATION_ARCHIVED_RETENTION_DAYS;
  }
  return EVENT_RETENTION_DAYS[stream];
}

export function expireAtFor(stream: EventStream, from: Date = new Date()): Timestamp {
  return Timestamp.fromMillis(from.getTime() + retentionDays(stream) * 86_400_000);
}
