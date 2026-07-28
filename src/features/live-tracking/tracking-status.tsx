"use client";

import { cn } from "@/lib/utils";
import { Pill, StatusDot, type Tone } from "@/components/ui/metric-tile";
import type { PinStatus, TrackingStatus } from "@/features/locations/types";

export type FleetStatusKey =
  | "available"
  | "delivering"
  | "idle"
  | "break"
  | "offline"
  | "alert"
  | "cluster";

const STATUS_TONES: Record<FleetStatusKey, Tone> = {
  available: "success",
  delivering: "primary",
  idle: "warning",
  break: "primary",
  offline: "neutral",
  alert: "danger",
  cluster: "primary",
};

export function fleetStatusFromLocation(input: {
  pinStatus: PinStatus;
  trackingStatus: TrackingStatus;
  isOnDuty: boolean;
}): FleetStatusKey {
  if (input.pinStatus === "alert") return "alert";
  if (!input.isOnDuty) return "offline";
  if (input.trackingStatus === "delivery_submit") return "delivering";
  if (input.trackingStatus === "moving") return "available";
  if (input.trackingStatus === "idle") return "idle";
  return "available";
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
  "break",
  "offline",
  "alert",
  "cluster",
];

export const LEGEND_FILTERABLE_STATUSES: FleetStatusKey[] = [
  "available",
  "delivering",
  "idle",
  "break",
  "offline",
  "alert",
];
