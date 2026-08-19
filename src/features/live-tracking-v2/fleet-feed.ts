/**
 * Live Events ranking.
 *
 * The feed is a log, but operators read the top row as "what is true now". A pickup
 * that scrolls under a movement ping, or a GPS-offline rider still headed by
 * "Entered zone", is the mismatch QA files as a status bug.
 *
 * GPS Offline is often decided on the local clock (`tickStatusDecay`) with no
 * Worker `gps.offline` row yet. Pinning only works if the key exists in the list,
 * so a missing current-status fact is synthesised here rather than left under a
 * leftover zone-entry.
 */

import { hasLiveTelemetry, type FleetEventSeverity, type FleetFlagSet, type FleetStatus } from "./fleet-status";
import type { FleetFeedItem } from "./fleet-types";

const EPISODE_CLOSERS: Record<string, readonly string[]> = {
  "delivery.pickup_create": ["delivery.complete", "delivery.cancel", "delivery.auto_cancel"],
  "duty.on": ["duty.off", "duty.auto_checkout"],
  "zone.exit": ["zone.entry"],
  "location.zone_exit": ["location.zone_entry"],
  "range.exit": ["range.entry"],
  "gps.offline": ["gps.restored"],
};

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

function currentPinKeys(driver: FeedDriverView): Set<string> {
  const keys = new Set<string>();
  switch (driver.status) {
    case "gps_offline":
      keys.add("gps.offline");
      break;
    case "location_off":
      keys.add("duty.location_cleared");
      break;
    case "offline":
      keys.add("duty.off");
      keys.add("duty.auto_checkout");
      break;
    case "on_delivery":
      keys.add("delivery.pickup_create");
      break;
    default:
      break;
  }
  if (driver.flags.out_of_zone) {
    keys.add("zone.exit");
    keys.add("location.zone_exit");
  }
  if (driver.flags.out_of_range) keys.add("range.exit");
  return keys;
}

function pinScore(
  item: FleetFeedItem,
  driver: FeedDriverView | undefined,
  latestCloserAt: Map<string, number>,
): number {
  if (driver && currentPinKeys(driver).has(item.eventKey)) return 2;
  const closers = EPISODE_CLOSERS[item.eventKey];
  if (!closers) return 0;
  // An open pickup must stay visible even when later movement events are newer —
  // vanishing after a few seconds is the same failure as never logging it.
  const closedAt = latestCloserAt.get(`${item.driverId}:${item.eventKey}`);
  if (closedAt != null && closedAt >= item.atMs) return 0;
  if (driver && item.eventKey === "delivery.pickup_create" && !hasLiveTelemetry(driver.status)) {
    return 1;
  }
  return 1;
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

  const latestCloserAt = new Map<string, number>();
  for (const item of ranked) {
    for (const [opener, closers] of Object.entries(EPISODE_CLOSERS)) {
      if (!closers.includes(item.eventKey)) continue;
      const key = `${item.driverId}:${opener}`;
      const prev = latestCloserAt.get(key) ?? 0;
      if (item.atMs > prev) latestCloserAt.set(key, item.atMs);
    }
  }

  return ranked.sort((a, b) => {
    const aScore = pinScore(a, byId.get(a.driverId), latestCloserAt);
    const bScore = pinScore(b, byId.get(b.driverId), latestCloserAt);
    if (aScore !== bScore) return bScore - aScore;
    return b.atMs - a.atMs;
  });
}
