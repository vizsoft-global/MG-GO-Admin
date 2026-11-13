import type { DriverOperationEvent } from "./operations-read-actions";

export type RawEventRow = {
  id: number | string;
  driver_id: string;
  category?: string | null;
  operation_key?: string | null;
  /** Written by the backend's `logDriverOperation` in place of the two above. */
  module?: string | null;
  action?: string | null;
  actor?: string | null;
  record_type?: string | null;
  record_id?: string | null;
  detail?: Record<string, unknown> | null;
  source?: string | null;
  source_name?: string | null;
  success?: boolean | null;
  error_code?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  context?: Record<string, unknown> | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  device_id?: string | null;
  app_version_code?: number | null;
  occurred_at: string;
  drivers:
    | {
        driver_code: string | null;
        profiles: { full_name: string | null } | { full_name: string | null }[] | null;
      }
    | Array<{
        driver_code: string | null;
        profiles: { full_name: string | null } | { full_name: string | null }[] | null;
      }>
    | null;
};

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Two writers fill this collection with two sets of field names. The rider app's
 * telemetry writes `category` / `operation_key`; the backend's own
 * `logDriverOperation` (zone entry and exit, a refused device heartbeat) writes
 * `module` / `action` / `actor` / `record_*` / `detail` and no `operation_key`.
 * Reading only the first set handed the timeline an event with no key, and the
 * label code called `.replace` on it: opening any rider whose last few events
 * included a zone entry crashed Live Tracking.
 */
export function mapEventRow(row: RawEventRow): DriverOperationEvent {
  const driver = Array.isArray(row.drivers) ? row.drivers[0] : row.drivers;
  const profile = Array.isArray(driver?.profiles) ? driver?.profiles[0] : driver?.profiles;
  const driverCode = driver?.driver_code ?? "—";
  const operationKey = textOf(row.operation_key) || textOf(row.action) || "unknown";
  const category = textOf(row.category) || textOf(row.module) || operationKey.split(".")[0] || "unknown";
  const context = row.context ?? row.detail;

  return {
    id: String(row.id),
    driverId: row.driver_id,
    driverName: profile?.full_name?.trim() || driverCode,
    driverCode,
    category,
    operationKey,
    source: textOf(row.source) || "rpc",
    sourceName: row.source_name ?? row.actor ?? null,
    success: row.success !== false,
    errorCode: row.error_code ?? null,
    entityType: row.entity_type ?? row.record_type ?? null,
    entityId: row.entity_id ?? row.record_id ?? null,
    context: context && typeof context === "object" ? context : {},
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    deviceId: row.device_id ?? null,
    appVersionCode: row.app_version_code ?? null,
    occurredAt: textOf(row.occurred_at),
  };
}
