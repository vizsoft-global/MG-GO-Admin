/**
 * Recent-history buffers for the map's trails.
 *
 * Kept out of `fleet-store`'s React snapshot on purpose: a trail changes on every
 * position frame, and putting it in the snapshot would re-render the rail and the KPI
 * tiles at the position cadence — exactly the coupling this page was built to remove.
 * The map reads these buffers inside its own animation frame, the same way it reads
 * the interpolator.
 *
 * Coordinates are held as one flat `lng, lat, …` array per driver so deck.gl's
 * `PathLayer` can consume them directly with `positionFormat: "XY"`. The alternative,
 * an array of `[lng, lat]` pairs, means one small array per point — around 100k live
 * objects across a 500-rider fleet, allocated and collected continuously.
 */

import {
  TRAIL_MIN_GAP_MS,
  TRAIL_MIN_MOVE_M,
  TRAIL_WINDOW_MS,
  trailDistanceMeters,
} from "./fleet-wire";

export type FleetTrail = {
  driverId: string;
  /** Flat `lng, lat` pairs, oldest first. GeoJSON order, as everywhere else here. */
  coords: number[];
  /** Server-clock ms per coordinate pair. Parallel to `coords`, half its length. */
  ts: number[];
  /** Stable per-rider colour, so two riders on one street stay separable. */
  color: [number, number, number];
  /** Bumped on every mutation, so the map can invalidate deck's tesselation. */
  revision: number;
  /** Memo for [trailSpanMeters]: the revision `spanM` was measured at. */
  spanRev: number;
  spanM: number;
};

/**
 * Diagonal of the trail's bounding box, in metres.
 *
 * The map uses this to decide whether a trail is a path or a smudge. A parked phone
 * still emits a point every [TRAIL_MIN_GAP_MS] — the gate is "moved 5m *or* 3s elapsed",
 * because a trail that stopped extending would otherwise look like a rider who
 * teleported — so ten minutes of standing still is ~200 points of GPS noise piled on the
 * marker. Drawn, that is a coloured blob around the pin, and with several riders parked
 * together it is the "multiple pointers in orange, green and blue" an operator cannot
 * read a status out of.
 *
 * Memoised against `revision` rather than maintained incrementally: pruning removes
 * points from the front, which can only be answered by rescanning, and a rescan of 200
 * numbers on the rare frame a trail changes is cheaper than the bookkeeping.
 */
export function trailSpanMeters(trail: FleetTrail): number {
  if (trail.spanRev === trail.revision) return trail.spanM;

  const n = trail.ts.length;
  let span = 0;
  if (n > 1) {
    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (let i = 0; i < n; i += 1) {
      const lng = trail.coords[i * 2]!;
      const lat = trail.coords[i * 2 + 1]!;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    span = trailDistanceMeters(minLat, minLng, maxLat, maxLng);
  }

  trail.spanM = span;
  trail.spanRev = trail.revision;
  return span;
}

/**
 * Golden-angle hue stepping over a string hash.
 *
 * Hashing straight to a hue clusters — adjacent hashes land on adjacent hues, and a
 * fleet is full of sequential driver codes. Multiplying by the golden angle spreads
 * any run of ids about as far apart as a hue circle allows.
 */
export function fleetTrailColor(driverId: string): [number, number, number] {
  let hash = 0;
  for (let i = 0; i < driverId.length; i += 1) {
    hash = (hash * 31 + driverId.charCodeAt(i)) | 0;
  }
  const hue = ((Math.abs(hash) * 137.508) % 360 + 360) % 360;
  // Saturation and lightness are fixed rather than hashed: a trail has to sit on both
  // roadmap and satellite tiles, and a hashed lightness would sometimes produce a line
  // that vanishes into the basemap.
  return hslToRgb(hue, 0.72, 0.52);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = l - c / 2;
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}

export class FleetTrailStore {
  private readonly trails = new Map<string, FleetTrail>();
  private rev = 0;

  /**
   * Bumped on every mutation anywhere in the store, so the map has one cheap value to
   * hand deck.gl as an `updateTriggers` key. Summing per-trail revisions each frame
   * would be the same information at 500x the cost.
   */
  get revision(): number {
    return this.rev;
  }

  get(driverId: string): FleetTrail | null {
    return this.trails.get(driverId) ?? null;
  }

  all(): FleetTrail[] {
    return [...this.trails.values()];
  }

  get size(): number {
    return this.trails.size;
  }

  private ensure(driverId: string): FleetTrail {
    let trail = this.trails.get(driverId);
    if (!trail) {
      trail = {
        driverId,
        coords: [],
        ts: [],
        color: fleetTrailColor(driverId),
        revision: 0,
        spanRev: -1,
        spanM: 0,
      };
      this.trails.set(driverId, trail);
    }
    return trail;
  }

  /**
   * Replaces a driver's history from a `trail` frame.
   *
   * Wire triplets are `lat*1e5, lng*1e5, unix seconds`; the buffer is `lng, lat`, so
   * this is also where the axis order is reconciled — once, rather than at every read.
   */
  hydrate(driverId: string, pts: readonly number[], nowMs: number): void {
    const trail = this.ensure(driverId);
    trail.coords = [];
    trail.ts = [];

    const cutoff = nowMs - TRAIL_WINDOW_MS;
    for (let i = 0; i + 2 < pts.length; i += 3) {
      const tMs = pts[i + 2]! * 1000;
      if (tMs < cutoff) continue;
      trail.coords.push(pts[i + 1]! / 1e5, pts[i]! / 1e5);
      trail.ts.push(tMs);
    }
    trail.revision += 1;
    this.rev += 1;
  }

  /**
   * Extends a trail from a live position, gated the same way the room gates its own
   * buffer. Without the gate a 4Hz delta stream would add four points a second for a
   * rider who has not moved a metre.
   */
  append(driverId: string, lat: number, lng: number, tsMs: number): boolean {
    const trail = this.ensure(driverId);
    const n = trail.ts.length;

    if (n > 0) {
      const lastMs = trail.ts[n - 1]!;
      if (tsMs <= lastMs) return false;
      const lastLng = trail.coords[(n - 1) * 2]!;
      const lastLat = trail.coords[(n - 1) * 2 + 1]!;
      const moved = trailDistanceMeters(lastLat, lastLng, lat, lng);
      if (moved < TRAIL_MIN_MOVE_M && tsMs - lastMs < TRAIL_MIN_GAP_MS) return false;
    }

    trail.coords.push(lng, lat);
    trail.ts.push(tsMs);
    this.pruneOne(trail, tsMs);
    trail.revision += 1;
    this.rev += 1;
    return true;
  }

  private pruneOne(trail: FleetTrail, nowMs: number): void {
    const cutoff = nowMs - TRAIL_WINDOW_MS;
    let drop = 0;
    while (drop < trail.ts.length && trail.ts[drop]! < cutoff) drop += 1;
    if (drop === 0) return;
    trail.ts.splice(0, drop);
    trail.coords.splice(0, drop * 2);
  }

  /**
   * Drops expired points fleet-wide. Called on a slow timer rather than per append,
   * because a rider who stops reporting stops pruning, and their tail would otherwise
   * hang on the map long after it left the window.
   */
  prune(nowMs: number): boolean {
    let changed = false;
    for (const trail of this.trails.values()) {
      const before = trail.ts.length;
      this.pruneOne(trail, nowMs);
      if (trail.ts.length !== before) {
        trail.revision += 1;
        this.rev += 1;
        changed = true;
      }
    }
    return changed;
  }

  remove(driverId: string): void {
    if (this.trails.delete(driverId)) this.rev += 1;
  }

  clear(): void {
    this.trails.clear();
    this.rev += 1;
  }
}
