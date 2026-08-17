/**
 * What a socket is allowed to see.
 *
 * Roster (meta + a seed position) follows filters only. Live 4Hz positions still
 * follow the viewport, because that is the cost that interest management exists to
 * cut. Mixing the two in one predicate is why an Out of Zone rider just outside the
 * fitted zone bounds never appeared in Driver Search: they had a pin, it was not in
 * the bbox, and they were never sent.
 */

import { inBbox } from "./geo";
import type { FleetStatus } from "../../../../src/features/live-tracking-v2/fleet-status";
import type { SocketView } from "../../../../src/features/live-tracking-v2/fleet-wire";

export type InterestSubject = {
  driverId: string;
  status: FleetStatus;
  lat: number | null;
  lng: number | null;
  zoneId: string | null;
  currentZoneId: string | null;
  partnerId: string | null;
  searchHaystack: string;
};

/** Status / zone / partner / pin — not the map frame. */
export function matchesRosterFilters(
  subject: InterestSubject,
  view: SocketView,
): boolean {
  if (view.driverId && subject.driverId === view.driverId) return true;
  if (
    view.statuses &&
    view.statuses.length > 0 &&
    !view.statuses.includes(subject.status)
  ) {
    return false;
  }
  if (
    view.zoneId &&
    subject.zoneId !== view.zoneId &&
    subject.currentZoneId !== view.zoneId
  ) {
    return false;
  }
  if (view.partnerId && subject.partnerId !== view.partnerId) return false;
  return true;
}

/**
 * High-frequency positions. Pinned and search hits stay live off-map so following
 * or looking someone up does not freeze their status. No-pin roster rows (blocked,
 * clocked out) do not belong here — they have nothing to stream.
 */
export function matchesLiveViewport(
  subject: InterestSubject,
  view: SocketView,
): boolean {
  if (view.driverId && subject.driverId === view.driverId) return true;
  const needle = view.search?.trim().toLowerCase();
  if (needle && subject.searchHaystack.includes(needle)) return true;
  if (subject.lat == null || subject.lng == null) return false;
  return inBbox(subject.lat, subject.lng, view.bbox);
}
