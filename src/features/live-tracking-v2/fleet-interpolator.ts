/**
 * Entity interpolation — the reason a 5-second GPS cadence can look continuous.
 *
 * The naive approach (move the marker when a fix arrives) is what makes v1 feel
 * broken: a pin teleports 60m, sits still for five seconds, teleports again. Instead
 * every entity keeps its two most recent fixes and the render loop asks for the
 * position at `now - RENDER_DELAY_MS`, which is almost always *between* them. The
 * cost is a fixed third of a second of latency; the benefit is smooth motion, and on
 * a fleet map knowing a rider is heading north at 40km/h matters more than knowing
 * exactly where they were 300ms ago.
 *
 * No React, no DOM: this is called from a requestAnimationFrame loop and must not
 * allocate per frame beyond the returned sample.
 */

const RENDER_DELAY_MS = 300;

/**
 * How long to keep dead-reckoning past the last fix. One cadence plus a little: at
 * 5s reports, a driver whose report is 6s late is probably still moving the same way,
 * but a driver silent for 30s is not, and inventing 400m of travel would be a lie
 * the operator cannot see through.
 */
const MAX_EXTRAPOLATE_MS = 6_000;

/** Below this, extrapolation is off: a stopped bike must not creep. */
const MIN_EXTRAPOLATE_SPEED_MPS = 1.5;

const METERS_PER_DEGREE_LAT = 111_320;

export type FleetSample = {
  lat: number;
  lng: number;
  headingDeg: number;
  speedMps: number;
  /** Server-clock ms. */
  tMs: number;
};

export type InterpolatedSample = {
  lat: number;
  lng: number;
  headingDeg: number;
  speedMps: number;
  /** True while the position is dead-reckoned rather than interpolated. */
  extrapolated: boolean;
};

type Track = {
  prev: FleetSample;
  next: FleetSample;
};

/** Shortest-arc angle lerp, so 350° → 10° turns 20° right rather than 340° left. */
function lerpHeading(a: number, b: number, t: number): number {
  const delta = ((b - a + 540) % 360) - 180;
  return (a + delta * t + 360) % 360;
}

export class FleetInterpolator {
  private readonly tracks = new Map<string, Track>();

  /**
   * Adds an authoritative fix. Out-of-order and duplicate timestamps are dropped
   * rather than reordered: a frame that arrives late is already stale, and letting it
   * become `next` would drag the marker backwards.
   */
  push(driverId: string, sample: FleetSample): void {
    const track = this.tracks.get(driverId);
    if (!track) {
      this.tracks.set(driverId, { prev: sample, next: sample });
      return;
    }
    if (sample.tMs <= track.next.tMs) return;
    track.prev = track.next;
    track.next = sample;
  }

  /** Snaps an entity to a position with no interpolation — used on first sight. */
  reset(driverId: string, sample: FleetSample): void {
    this.tracks.set(driverId, { prev: sample, next: sample });
  }

  remove(driverId: string): void {
    this.tracks.delete(driverId);
  }

  clear(): void {
    this.tracks.clear();
  }

  has(driverId: string): boolean {
    return this.tracks.has(driverId);
  }

  /**
   * Position to draw at `nowMs` (server clock). Returns null for an entity with no
   * fixes yet.
   */
  sample(driverId: string, nowMs: number): InterpolatedSample | null {
    const track = this.tracks.get(driverId);
    if (!track) return null;

    const { prev, next } = track;
    const renderAt = nowMs - RENDER_DELAY_MS;

    if (renderAt <= prev.tMs || prev.tMs === next.tMs) {
      // Before the window, or only one fix known: hold still rather than guess.
      const anchor = renderAt <= prev.tMs ? prev : next;
      return {
        lat: anchor.lat,
        lng: anchor.lng,
        headingDeg: anchor.headingDeg,
        speedMps: anchor.speedMps,
        extrapolated: false,
      };
    }

    if (renderAt <= next.tMs) {
      const span = next.tMs - prev.tMs;
      const t = (renderAt - prev.tMs) / span;
      return {
        lat: prev.lat + (next.lat - prev.lat) * t,
        lng: prev.lng + (next.lng - prev.lng) * t,
        headingDeg: lerpHeading(prev.headingDeg, next.headingDeg, t),
        speedMps: prev.speedMps + (next.speedMps - prev.speedMps) * t,
        extrapolated: false,
      };
    }

    // Past the last fix: dead reckon, briefly.
    const overshootMs = Math.min(renderAt - next.tMs, MAX_EXTRAPOLATE_MS);
    if (next.speedMps < MIN_EXTRAPOLATE_SPEED_MPS) {
      return {
        lat: next.lat,
        lng: next.lng,
        headingDeg: next.headingDeg,
        speedMps: next.speedMps,
        extrapolated: false,
      };
    }

    const distanceM = next.speedMps * (overshootMs / 1000);
    const radians = (next.headingDeg * Math.PI) / 180;
    const dLat = (distanceM * Math.cos(radians)) / METERS_PER_DEGREE_LAT;
    const lngScale =
      METERS_PER_DEGREE_LAT * Math.max(Math.cos((next.lat * Math.PI) / 180), 0.01);
    const dLng = (distanceM * Math.sin(radians)) / lngScale;

    return {
      lat: next.lat + dLat,
      lng: next.lng + dLng,
      headingDeg: next.headingDeg,
      speedMps: next.speedMps,
      extrapolated: overshootMs > 0,
    };
  }

  /** Last authoritative fix, for anything that must not read an invented position. */
  latest(driverId: string): FleetSample | null {
    return this.tracks.get(driverId)?.next ?? null;
  }
}

export const FLEET_RENDER_DELAY_MS = RENDER_DELAY_MS;
export const FLEET_MAX_EXTRAPOLATE_MS = MAX_EXTRAPOLATE_MS;
