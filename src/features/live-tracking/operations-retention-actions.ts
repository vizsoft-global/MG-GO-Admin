"use server";

import { callCronFunction } from "@/lib/firebase/callable";

export type DriverOpsAuditHealth = {
  configured: boolean;
  reachable: boolean;
  reason: string | null;
  failures_24h?: number;
};

export type DriverOpsRetentionResult = {
  operationEventsDeleted: number;
  locationEventsDeleted: number;
  auditHealth: DriverOpsAuditHealth;
};

/**
 * Cron: trim both append-only driver streams and report on the autonomous audit
 * path. Both RPCs delete in batches, so a run that hits the batch ceiling simply
 * carries on the next night.
 */
export async function runDriverOpsRetention(options?: {
  operationKeep?: string;
  locationKeep?: string;
  batch?: number;
}): Promise<DriverOpsRetentionResult> {
  const [ops, locations, health] = await Promise.all([
    callCronFunction<number>("cleanup_driver_operation_events", {
      p_keep: options?.operationKeep ?? undefined,
      p_batch: options?.batch ?? undefined,
    }),
    callCronFunction<number>("cleanup_driver_location_events", {
      p_keep: options?.locationKeep ?? undefined,
      p_batch: options?.batch ?? undefined,
    }),
    callCronFunction<DriverOpsAuditHealth>("driver_ops_audit_health"),
  ]);

  if (ops.error) throw new Error(ops.error.message);
  if (locations.error) throw new Error(locations.error.message);
  if (health.error) throw new Error(health.error.message);

  return {
    operationEventsDeleted: typeof ops.data === "number" ? ops.data : 0,
    locationEventsDeleted: typeof locations.data === "number" ? locations.data : 0,
    auditHealth: health.data as DriverOpsAuditHealth,
  };
}
