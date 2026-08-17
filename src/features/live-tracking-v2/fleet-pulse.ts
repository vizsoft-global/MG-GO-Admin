/**
 * Pulse rings: the visible proof that a position is still arriving.
 *
 * The interpolated sprite answers "where is this rider"; it cannot answer "is this map
 * still being fed". A sprite that glides to a stop looks exactly like a sprite that
 * stopped being told anything, which is the one confusion this page exists to remove —
 * and the reason the connection pill had to start measuring positions rather than frames.
 * A ring that expands once per fix puts that liveness on the marker itself.
 *
 * So a pulse here is **one shot per fix**, not a decorative loop. V1's DOM overlay
 * animates `1.8s ease-out infinite` regardless of whether anything is reporting, which
 * means it keeps pulsing over a rider whose phone died. That overlay is also one DOM node
 * per driver, and this page draws 500 markers in a single GPU pass.
 *
 * No React, no DOM, no deck.gl: the map calls this from its animation frame, and the
 * rules are unit-tested without a browser.
 */

import { hasLiveTelemetry, type FleetStatus } from "./fleet-status";

/**
 * Ring lifetime. Longer than the rulebook's 300ms ceiling on purpose: that ceiling
 * governs *chrome* an operator drives (buttons, dropdowns, modals), where anything
 * slower than the click feels laggy. This is ambient map telemetry nobody clicked, and
 * at 1Hz a ring shorter than the cadence reads as a flicker rather than a heartbeat.
 */
export const FLEET_PULSE_DURATION_MS = 900;

/**
 * Concurrent rings, besides the selected rider who is always drawn.
 *
 * Rings are cheap individually (one scatterplot instance each) but they are the only
 * layer whose contents change every frame for every member, so the cap is what keeps
 * the per-frame accessor work flat at 500 drivers. At a city-wide zoom 50 expanding
 * rings already read as "the fleet is reporting", which is the entire message.
 */
export const FLEET_PULSE_MAX = 50;

/** Ring geometry, in screen pixels — a puck is 8px, so the ring starts at its edge. */
export const FLEET_PULSE_MIN_RADIUS_PX = 8;
export const FLEET_PULSE_MAX_RADIUS_PX = 22;

/** Peak ring alpha (0-255). Deliberately faint: the status puck must stay the loudest thing. */
export const FLEET_PULSE_PEAK_ALPHA = 110;

/**
 * Reduced motion keeps the ring but not the expansion, matching how the interpolator
 * snaps instead of animating: the operator still sees *which* riders are reporting, they
 * just do not see it move.
 */
export const FLEET_PULSE_STATIC_RADIUS_PX = 11;
export const FLEET_PULSE_STATIC_ALPHA = 70;

/**
 * Deterministic start jitter, as a fraction of the duration.
 *
 * On the edge rail fixes arrive independently and are naturally staggered. On the
 * snapshot poll they all carry the same `generated_at`, so every ring would start on the
 * same millisecond and the whole map would strobe in unison — which reads as a UI
 * artefact rather than as telemetry. A quarter of the duration is enough to break the
 * lockstep and still lands the ring inside the same second as its fix.
 */
const PULSE_JITTER_FRACTION = 0.25;

/**
 * Whether a driver may pulse at all.
 *
 * `hasLiveTelemetry` is the same gate the driver card uses before printing a speed, and
 * for the same reason: a ring is a claim that something arrived just now. An Offline or
 * GPS Offline pin must sit still, because "stopped reporting" is exactly the state the
 * operator is looking for.
 *
 * Idle is live but does not pulse unless selected — a car park of idle riders pulsing in
 * turn is motion with no information, and it would spend the whole cap on the drivers
 * least worth watching.
 */
export function pulseEligible(status: FleetStatus, selected: boolean): boolean {
  if (!hasLiveTelemetry(status)) return false;
  if (selected) return true;
  return status === "moving" || status === "on_delivery";
}

/** FNV-1a over the driver id: stable across reloads, so a rider's jitter never changes. */
function hashDriverId(driverId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < driverId.length; index += 1) {
    hash ^= driverId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Per-driver start delay. See [PULSE_JITTER_FRACTION]. */
export function pulseStartJitterMs(
  driverId: string,
  durationMs: number = FLEET_PULSE_DURATION_MS,
): number {
  const window = Math.max(1, Math.floor(durationMs * PULSE_JITTER_FRACTION));
  return hashDriverId(driverId) % window;
}

/**
 * Progress through a ring's life: `0` at its start, approaching `1` at its end.
 *
 * `null` means there is nothing to draw — either the jittered start has not arrived yet
 * or the ring has expired. Returning null rather than clamping is what lets the map drop
 * the driver from the layer's data instead of drawing an invisible circle for it.
 */
export function pulsePhase(
  nowMs: number,
  startedAtMs: number,
  durationMs: number = FLEET_PULSE_DURATION_MS,
): number | null {
  const elapsed = nowMs - startedAtMs;
  if (elapsed < 0 || elapsed >= durationMs) return null;
  return elapsed / durationMs;
}

export type FleetPulseRing = {
  radiusPx: number;
  /** 0-255, for a deck.gl RGBA accessor. */
  alpha: number;
};

/** Ring geometry at `phase`. Ease-out, so the ring leaves the puck fast and settles. */
export function pulseRing(phase: number, reducedMotion = false): FleetPulseRing {
  if (reducedMotion) {
    return { radiusPx: FLEET_PULSE_STATIC_RADIUS_PX, alpha: FLEET_PULSE_STATIC_ALPHA };
  }
  const clamped = Math.min(1, Math.max(0, phase));
  const eased = 1 - (1 - clamped) ** 3;
  return {
    radiusPx:
      FLEET_PULSE_MIN_RADIUS_PX +
      (FLEET_PULSE_MAX_RADIUS_PX - FLEET_PULSE_MIN_RADIUS_PX) * eased,
    alpha: Math.round(FLEET_PULSE_PEAK_ALPHA * (1 - clamped)),
  };
}

/**
 * Trims the candidates to the cap, keeping the selected rider whatever their position in
 * the list. The selected rider is the one the operator is actively watching, so losing
 * their ring to a cap would be the one omission they would notice.
 */
export function selectPulseDrivers(
  candidates: readonly string[],
  selectedDriverId: string | null,
  cap: number = FLEET_PULSE_MAX,
): string[] {
  if (cap <= 0) return [];
  if (candidates.length <= cap) return [...candidates];

  const picked: string[] = [];
  if (selectedDriverId && candidates.includes(selectedDriverId)) {
    picked.push(selectedDriverId);
  }
  for (const driverId of candidates) {
    if (picked.length >= cap) break;
    if (driverId === selectedDriverId) continue;
    picked.push(driverId);
  }
  return picked;
}

/**
 * Turns a stream of fixes into ring start times.
 *
 * Keyed on the *fix* timestamp rather than on arrival, so a replayed or duplicated frame
 * cannot restart a ring: the room re-sends a driver's last position when they enter a
 * socket's viewport, and a ring per pan would make an idle fleet look busy.
 */
export class FleetPulseTracker {
  private readonly lastFixAt = new Map<string, number>();
  private readonly startedAt = new Map<string, number>();

  /**
   * Records the newest fix for a driver. Starts a ring when the fix is one this tracker
   * has not seen; older or repeated timestamps are ignored.
   */
  observe(driverId: string, fixAtMs: number, nowMs: number): void {
    if (!Number.isFinite(fixAtMs) || fixAtMs <= 0) return;
    const previous = this.lastFixAt.get(driverId);
    if (previous != null && fixAtMs <= previous) return;

    this.lastFixAt.set(driverId, fixAtMs);
    // First sighting is not a pulse: every driver in the initial snapshot would ring at
    // once, which says nothing about who is reporting *now*.
    if (previous == null) return;
    this.startedAt.set(driverId, nowMs + pulseStartJitterMs(driverId));
  }

  /** Progress of this driver's running ring, or null when there is nothing to draw. */
  phase(driverId: string, nowMs: number): number | null {
    const startedAt = this.startedAt.get(driverId);
    if (startedAt == null) return null;
    const phase = pulsePhase(nowMs, startedAt);
    if (phase == null && nowMs >= startedAt) this.startedAt.delete(driverId);
    return phase;
  }

  forget(driverId: string): void {
    this.lastFixAt.delete(driverId);
    this.startedAt.delete(driverId);
  }

  clear(): void {
    this.lastFixAt.clear();
    this.startedAt.clear();
  }
}
