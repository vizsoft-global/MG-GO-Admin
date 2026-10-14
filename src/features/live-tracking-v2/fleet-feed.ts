/**
 * Live Events list.
 *
 * The feed is a chronological log (`atMs` descending). Current-status facts the
 * local clock can know without a Worker row (GPS offline, location off) are still
 * synthesised so the list is not headed by a leftover zone-entry — but they take
 * their own timestamp and do not outrank a newer event.
 */

import { type FleetEventSeverity, type FleetFlagSet, type FleetStatus } from "./fleet-status";
import type { FleetFeedItem } from "./fleet-types";

/** Status facts the local clock can know without a Worker event. */
const SYNTHETIC_STATUS_PIN: Partial<
  Record<FleetStatus, { key: string; severity: FleetEventSeverity }>
> = {
  gps_offline: { key: "gps.offline", severity: "warning" },
  location_off: { key: "duty.location_cleared", severity: "warning" },
};

export type FeedDriverView = {
  driverId: string;
  status: FleetStatus;
  flags: FleetFlagSet;
};

function syntheticCurrentItem(
  driver: FeedDriverView,
  eventKey: string,
  severity: FleetEventSeverity,
  nowMs: number,
): FleetFeedItem {
  return {
    id: `synthetic:${driver.driverId}:${eventKey}`,
    kind: "fleet",
    driverId: driver.driverId,
    driverName: null,
    eventKey,
    severity,
    value: null,
    statusAfter: driver.status,
    success: true,
    errorCode: null,
    latitude: null,
    longitude: null,
    context: { synthetic: true },
    atMs: nowMs,
  };
}

export function composeFleetFeed(
  items: readonly FleetFeedItem[],
  drivers: Iterable<FeedDriverView>,
  nowMs: number = Date.now(),
): FleetFeedItem[] {
  const byId = new Map<string, FeedDriverView>();
  for (const driver of drivers) byId.set(driver.driverId, driver);

  const ranked: FleetFeedItem[] = [...items];
  for (const driver of byId.values()) {
    const pin = SYNTHETIC_STATUS_PIN[driver.status];
    if (!pin) continue;
    if (ranked.some((item) => item.driverId === driver.driverId && item.eventKey === pin.key)) {
      continue;
    }
    ranked.push(syntheticCurrentItem(driver, pin.key, pin.severity, nowMs));
  }

  return ranked.sort((a, b) => b.atMs - a.atMs);
}
