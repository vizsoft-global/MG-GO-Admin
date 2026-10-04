"use client";

import { cn } from "@/lib/utils";
import { Pill, StatusDot, type Tone } from "@/components/ui/metric-tile";
import type { PinStatus, TrackingStatus } from "@/features/locations/types";
import { isGpsLive } from "@/features/locations/location-status";
import { hasMotion } from "@/features/live-tracking-v2/fleet-status";

export type FleetStatusKey =
  | "available"
  | "delivering"
  | "idle"
  | "break"
  | "offline"
  | "alert"
  | "cluster";

export type LiveListStatus =
  | "offline"
  | "moving"
  | "idle"
  | "delivery_submit"
  | "delivered"
  | "blocked";

const STATUS_TONES: Record<FleetStatusKey, Tone> = {
  available: "success",
  delivering: "primary",
  idle: "warning",
  break: "primary",
  offline: "neutral",
  alert: "danger",
  cluster: "primary",
};

export function liveListStatus(input: {
  isOnDuty: boolean;
  trackingStatus: TrackingStatus;
  speedMps: number | null;
  /** Metres since the previous fix — the motion half a coarse `speed_mps` cannot report. */
  movedMeters?: number | null;
  lastSeenAt: string;
  now?: number;
  isBlocked?: boolean;
  activeDeliveryId?: string | null;
}): LiveListStatus {
  if (input.isBlocked) return "blocked";
  if (!input.isOnDuty) return "offline";
  if (
    !input.lastSeenAt ||
    !isGpsLive(
      input.lastSeenAt,
      input.now,
      undefined,
      input.trackingStatus,
      input.speedMps,
    )
  ) {
    return "offline";
  }
  if (input.trackingStatus === "delivery_submit" && input.activeDeliveryId) {
    return "delivery_submit";
  }
  if (input.trackingStatus === "moving") return "moving";
  // One shared motion rule (`speed or >= 15 m displacement`), so a rider who is travelling on
  // a coarse fix that reports 0 m/s reads Moving instead of Idle (QA #50).
  if (hasMotion(input)) return "moving";
  return "idle";
}

export function liveListStatusTone(
  status: LiveListStatus,
  zoneStatus: "in_zone" | "out_of_zone" | "unknown" | null,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "offline") return "neutral";
  if (status === "blocked") return "danger";
  if (zoneStatus === "out_of_zone") return "danger";
  if (status === "idle") return "warning";
  return "success";
}

export function fleetStatusFromLocation(input: {
  pinStatus: PinStatus;
  trackingStatus: TrackingStatus;
  isOnDuty: boolean;
  speedMps?: number | null;
  /** Metres since the previous fix — see `liveListStatus`. */
  movedMeters?: number | null;
  lastSeenAt?: string;
  now?: number;
  isBlocked?: boolean;
  activeDeliveryId?: string | null;
}): FleetStatusKey {
  if (input.isBlocked) return "offline";
  if (!input.isOnDuty) return "offline";
  if (
    input.lastSeenAt != null &&
    !isGpsLive(
      input.lastSeenAt,
      input.now,
      undefined,
      input.trackingStatus,
      input.speedMps,
    )
  ) {
    return "offline";
  }
  if (input.pinStatus === "alert") return "alert";
  if (input.trackingStatus === "delivery_submit" && input.activeDeliveryId) {
    return "delivering";
  }
  if (hasMotion(input)) return "available";
  return "idle";
}

export function TrackingStatusDot({
  status,
  className,
  pulse,
}: {
  status: FleetStatusKey;
  className?: string;
  pulse?: boolean;
}) {
  return (
    <StatusDot
      tone={STATUS_TONES[status]}
      className={cn(pulse && status === "alert" && "animate-pulse", className)}
    />
  );
}

export function TrackingStatusPill({
  status,
  label,
  className,
}: {
  status: FleetStatusKey;
  label: string;
  className?: string;
}) {
  return (
    <Pill tone={STATUS_TONES[status]} className={className}>
      <TrackingStatusDot status={status} />
      {label}
    </Pill>
  );
}

export const LEGEND_STATUSES: FleetStatusKey[] = [
  "available",
  "delivering",
  "idle",
  "offline",
  "alert",
];

export const LEGEND_FILTERABLE_STATUSES: FleetStatusKey[] = [
  "available",
  "delivering",
  "idle",
  "offline",
  "alert",
];
