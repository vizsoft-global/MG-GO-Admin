import type { EdgeArchivePoint } from "@/lib/fleet/edge-read";

import { parseTrackingStatus } from "./location-status";
import type { DriverLocationEvent } from "./types";

export function eventFromArchivePoint(driverId: string, point: EdgeArchivePoint): DriverLocationEvent {
  return {
    id: `${driverId}:${point.t}`,
    driverId,
    latitude: point.la,
    longitude: point.lo,
    speedMps: point.s,
    accuracyMeters: point.a,
    batteryPct: point.b,
    headingDeg: point.h,
    isMocked: point.m === 1,
    activeDeliveryId: point.ad,
    trackingStatus: parseTrackingStatus(point.st),
    zoneStatus: null,
    deliveryId: point.d ?? point.ad,
    recordedAt: new Date(point.t).toISOString(),
    submitAction: null,
  };
}

export function kuwaitDay(at: Date | string | number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuwait" }).format(new Date(at));
}
