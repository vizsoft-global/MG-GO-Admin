/**
 * Camera rules for the fleet canvas.
 *
 * Pure geometry, deliberately separate from `fleet-map`: "should the camera move" is a
 * decision with edge cases (an operator who has dragged the map, a rider who is only
 * slightly off-centre, a route that has to be framed once and then followed), and those
 * cases are worth testing without a Google Maps instance.
 */

/** A viewport, in the same `lng, lat` order as everything else in this feature. */
export type FleetBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/**
 * How much of the viewport is treated as edge.
 *
 * Recentring the instant a rider leaves the exact centre would make the map crawl
 * continuously and fight every small gesture. A fifth of the viewport on each side means
 * the camera stays put while the rider is comfortably visible and only moves when they
 * are about to leave the screen.
 */
export const FLEET_KEEP_IN_VIEW_PADDING = 0.2;

/** Padding, in pixels, used whenever the camera frames a set of points. */
export const FLEET_FIT_PADDING_PX = 64;

function longitudeSpan(bounds: FleetBounds): number {
  const span = bounds.east - bounds.west;
  // A viewport crossing the antimeridian reports east < west. Irrelevant in Kuwait, but
  // a negative span would invert every comparison below, so it is normalised rather than
  // assumed away.
  return span >= 0 ? span : span + 360;
}

function longitudeOffset(from: number, to: number): number {
  const delta = ((to - from + 540) % 360) - 180;
  return delta;
}

/**
 * Whether the camera should be brought back to `position`.
 *
 * True when the point is outside the padded box, or when the viewport is degenerate
 * (zero span — a map that has not laid out yet), because the safe answer there is to
 * centre rather than to leave the rider off-screen.
 */
export function needsRecentre(
  position: [number, number],
  bounds: FleetBounds,
  padding: number = FLEET_KEEP_IN_VIEW_PADDING,
): boolean {
  const [lng, lat] = position;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;

  const lngSpan = longitudeSpan(bounds);
  const latSpan = bounds.north - bounds.south;
  if (lngSpan <= 0 || latSpan <= 0) return true;

  const lngInset = lngSpan * padding;
  const latInset = latSpan * padding;

  const fromWest = longitudeOffset(bounds.west, lng);
  if (fromWest < lngInset || fromWest > lngSpan - lngInset) return true;

  if (lat < bounds.south + latInset || lat > bounds.north - latInset) return true;

  return false;
}

/**
 * Bounding box of a path, or null when there is nothing to frame.
 *
 * A single point is not a box: framing it would ask Google Maps to fit a zero-area
 * bounds, which snaps to maximum zoom. The caller centres in that case instead.
 */
export function pathBounds(path: readonly [number, number][]): FleetBounds | null {
  if (path.length < 2) return null;

  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;

  for (const [lng, lat] of path) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }

  if (west === Infinity || south === Infinity) return null;
  if (west === east && south === north) return null;
  return { west, south, east, north };
}
