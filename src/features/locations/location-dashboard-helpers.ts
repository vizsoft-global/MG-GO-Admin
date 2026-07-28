import { isGpsStale } from "./location-status";
import type { DriverLiveLocation } from "./types";
import type { AlertCenterItem, ComplianceItem } from "@/features/dashboard/types";

export function buildGpsAlerts(locations: DriverLiveLocation[]): AlertCenterItem[] {
  if (locations.length === 0) return [];

  const now = new Date().toISOString();
  const alerts: AlertCenterItem[] = [];

  const outOfZone = locations.filter((l) => l.zoneStatus === "out_of_zone");
  for (const loc of outOfZone) {
    alerts.push({
      id: `gps-zone-${loc.driverId}`,
      severity: "danger",
      messageKey: "outsideZone",
      detail: loc.driverName,
      at: loc.lastSeenAt,
      isLive: true,
    });
  }

  const stale = locations.filter((l) => isGpsStale(l.lastSeenAt, l.trackingStatus));
  if (stale.length > 0) {
    alerts.push({
      id: "gps-stale-aggregate",
      severity: "warning",
      messageKey: "gpsStale",
      detail: `${stale.length} driver(s) with stale GPS`,
      at: now,
      isLive: true,
    });
  }

  return alerts;
}

export function buildGpsCompliance(
  locations: DriverLiveLocation[],
  onDutyWithoutGps: Array<{ driverId: string; driverName: string; driverCode: string }>,
): ComplianceItem[] {
  const items: ComplianceItem[] = [];

  if (locations.length > 0) {
    for (const loc of locations) {
      if (isGpsStale(loc.lastSeenAt, loc.trackingStatus)) {
        items.push({
          id: `gps-inactive-${loc.driverId}`,
          driverName: loc.driverName,
          driverCode: loc.driverCode,
          issueKey: "appInactive",
          detail: loc.lastSeenAt,
          severity: "warning",
        });
      }
      if (loc.batteryPct != null && loc.batteryPct < 15) {
        items.push({
          id: `gps-battery-${loc.driverId}`,
          driverName: loc.driverName,
          driverCode: loc.driverCode,
          issueKey: "lowBattery",
          detail: `${loc.batteryPct}%`,
          severity: "warning",
        });
      }
    }
  }

  for (const d of onDutyWithoutGps) {
    items.push({
      id: `gps-missing-${d.driverId}`,
      driverName: d.driverName,
      driverCode: d.driverCode,
      issueKey: "noGps",
      detail: "on_duty",
      severity: "danger",
    });
  }

  return items.slice(0, 8);
}

export function presencePinsFromLocations(
  locations: DriverLiveLocation[],
): Array<{
  id: string;
  driverName: string;
  lat: number;
  lng: number;
  status: "active" | "idle" | "alert";
  lastSeenAt: string;
  restaurantName: string;
  outOfZone: boolean;
  gpsInactive: boolean;
}> {
  return locations.map((loc) => ({
    id: loc.driverId,
    driverName: loc.driverName,
    lat: loc.latitude,
    lng: loc.longitude,
    status: loc.pinStatus,
    lastSeenAt: loc.lastSeenAt,
    restaurantName: loc.restaurantName ?? "—",
    outOfZone: loc.zoneStatus === "out_of_zone",
    gpsInactive: isGpsStale(loc.lastSeenAt, loc.trackingStatus),
  }));
}
