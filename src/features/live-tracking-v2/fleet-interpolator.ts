/**
 * Entity interpolation — the reason a 1-second GPS cadence can look continuous.
 *
 * The naive approach (move the marker when a fix arrives) is what makes v1 feel
 * broken: a pin teleports 60m, sits still, teleports again. Instead every entity keeps
 * its two most recent fixes and the render loop asks for the position at
 * `now - renderDelayMs`, which should almost always be *between* them.
 *
 * The delay is **measured, not fixed**, and that is the single change that turns this
 * from dead reckoning into real interpolation. A fixed 300ms buffer against a 1Hz
 * stream lands past the newest fix roughly every frame, so the marker spends its life
 * extrapolating — smooth, but guessing, and wrong on every corner because a
 * dead-reckoned bike travels straight through the turn. Buffering just over one
 * measured cadence puts the render clock between two known fixes, so the marker
 * follows the road the rider actually took.
 *
 * The cost is latency equal to that buffer. On a fleet map, knowing a rider is heading
 * north at 40km/h matters more than knowing exactly where they were a second ago.
 *
 * No React, no DOM: this is called from a requestAnimationFrame loop and must not
 * allocate per frame beyond the returned sample.
 */

/**
 * Buffer floor and ceiling. The floor is v1's old fixed value, which is right when
 * fixes arrive faster than they can be drawn; the ceiling bounds how stale the map may
 * become when a rail degrades to 10-second polling — past two seconds an operator is
 * being shown history and told it is live.
 */
const RENDER_DELAY_MIN_MS = 300;
const RENDER_DELAY_MAX_MS = 2_000;

/** Buffer as a multiple of the measured cadence — just over one, so jitter is absorbed. */
const RENDER_DELAY_FACTOR = 1.2;

/** Recent inter-fix gaps kept for the median. */
const GAP_SAMPLE_SIZE = 64;
/** Recompute the median every this many samples: a 64-element sort, rarely. */
const MEDIAN_STALE_AFTER = 8;

/**
 * Gaps outside this range are not cadence and would mislead the estimate: below the
 * floor is a duplicate or a burst, above the ceiling is a reconnect or a phone that
 * was in a tunnel. The median is robust to outliers, but a room full of reconnecting
 * drivers is not an outlier, it is a bias.
 */
const GAP_MIN_MS = 200;
const GAP_MAX_MS = 10_000;

/**
 * How long to keep dead-reckoning past the last fix.
 *
 * At 1Hz, two and a half seconds of silence is already ~25 missed reports, so anything
 * longer is inventing travel the operator cannot see through — and with the adaptive
 * buffer above, extrapolation is now the exception rather than the steady state, which
 * is what makes it affordable to cut this from the 6s a 5-second cadence needed.
 */
const MAX_EXTRAPOLATE_MS = 2_500;

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

  /** Ring of recent inter-fix gaps, fleet-wide. */
  private readonly gaps: number[] = [];
  private gapCursor = 0;
  private sinceMedian = MEDIAN_STALE_AFTER;
  private medianGap = 0;
  private delayMs = RENDER_DELAY_MIN_MS;

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
    this.recordGap(sample.tMs - track.next.tMs);
    track.prev = track.next;
    track.next = sample;
  }

  /**
   * Cadence is measured fleet-wide rather than per driver, because the buffer is one
   * render decision for the whole map: per-driver delays would draw two riders at the
   * same intersection at two different moments.
   */
  private recordGap(gapMs: number): void {
    if (gapMs < GAP_MIN_MS || gapMs > GAP_MAX_MS) return;
    if (this.gaps.length < GAP_SAMPLE_SIZE) {
      this.gaps.push(gapMs);
    } else {
      this.gaps[this.gapCursor] = gapMs;
      this.gapCursor = (this.gapCursor + 1) % GAP_SAMPLE_SIZE;
    }
    this.sinceMedian += 1;
  }

  private refreshDelay(): void {
    if (this.gaps.length === 0) {
      this.medianGap = 0;
      this.delayMs = RENDER_DELAY_MIN_MS;
      return;
    }
    const sorted = [...this.gaps].sort((a, b) => a - b);
    this.medianGap = sorted[Math.floor(sorted.length / 2)]!;
    this.delayMs = Math.round(
      Math.min(
        RENDER_DELAY_MAX_MS,
        Math.max(RENDER_DELAY_MIN_MS, this.medianGap * RENDER_DELAY_FACTOR),
      ),
    );
    this.sinceMedian = 0;
  }

  /** Current render buffer. Read once per frame by the map, not per entity. */
  get renderDelayMs(): number {
    if (this.sinceMedian >= MEDIAN_STALE_AFTER) this.refreshDelay();
    return this.delayMs;
  }

  /** Measured cadence. Exposed so the connection pill and tests can see the estimate. */
  get medianGapMs(): number {
    if (this.sinceMedian >= MEDIAN_STALE_AFTER) this.refreshDelay();
    return this.medianGap;
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
    this.gaps.length = 0;
    this.gapCursor = 0;
    this.sinceMedian = MEDIAN_STALE_AFTER;
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
    const renderAt = nowMs - this.renderDelayMs;

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

export const FLEET_RENDER_DELAY_MIN_MS = RENDER_DELAY_MIN_MS;
export const FLEET_RENDER_DELAY_MAX_MS = RENDER_DELAY_MAX_MS;
export const FLEET_RENDER_DELAY_FACTOR = RENDER_DELAY_FACTOR;
export const FLEET_MAX_EXTRAPOLATE_MS = MAX_EXTRAPOLATE_MS;
