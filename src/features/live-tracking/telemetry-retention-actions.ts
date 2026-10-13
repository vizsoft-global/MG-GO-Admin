"use server";

import { callCronFunction } from "@/lib/firebase/callable";

export type DriverTelemetryRetentionResult = {
  telemetryEventsDeleted: number;
};

/**
 * Deliberately its own action and its own cron rather than another RPC inside
 * `runDriverOpsRetention`: the Phase 1 retention path also carries the
 * autonomous-audit health probe, and a telemetry cleanup failure must not be
 * able to mask that.
 */
export async function runDriverTelemetryRetention(options?: {
  keep?: string;
  batch?: number;
}): Promise<DriverTelemetryRetentionResult> {
  const { data, error } = await callCronFunction<number>("cleanup_driver_telemetry_events", {
    p_keep: options?.keep ?? undefined,
    p_batch: options?.batch ?? undefined,
  });

  if (error) throw new Error(error.message);

  return {
    telemetryEventsDeleted: typeof data === "number" ? data : 0,
  };
}
