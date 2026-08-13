"use server";

import { createAdminClient } from "@/lib/supabase/admin";

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
  const supabase = createAdminClient();

  const [ops, locations, health] = await Promise.all([
    supabase.rpc("cleanup_driver_operation_events", {
      p_keep: options?.operationKeep ?? undefined,
      p_batch: options?.batch ?? undefined,
    }),
    supabase.rpc("cleanup_driver_location_events", {
      p_keep: options?.locationKeep ?? undefined,
      p_batch: options?.batch ?? undefined,
    }),
    supabase.rpc("driver_ops_audit_health"),
  ]);

  if (ops.error) throw ops.error;
  if (locations.error) throw locations.error;
  if (health.error) throw health.error;

  return {
    operationEventsDeleted: typeof ops.data === "number" ? ops.data : 0,
    locationEventsDeleted: typeof locations.data === "number" ? locations.data : 0,
    auditHealth: health.data as unknown as DriverOpsAuditHealth,
  };
}
