/**
 * Class B event detection: thresholds over the position stream.
 *
 * Pure functions with the state passed in and out, so every flap case is unit
 * testable without a Durable Object. Hysteresis is not optional here — without it
 * a driver parked on a zone boundary, or holding 60 km/h on a motorway, would write
 * a row every five seconds and drown the feed it is supposed to serve.
 *
 * Class A events (clock in/out, pickup, delivery, shift submit, delivery-range zone
 * crossings) are NOT produced here. They are authored server-side in
 * `driver_operation_events` and relayed verbatim; inventing an edge copy would give
 * the operator two versions of the same fact.
 */

import {
  FLEET_EVENT_KEYS,
  fleetEventSeverity,
  fleetFlags,
  fleetStatus,
  isLowBattery,
  isOverspeeding,
  normalizeBatteryPct,
  resolveFleetThresholds,
  type FleetEntitySignals,
  type FleetEventKey,
  type FleetEventSeverity,
  type FleetFlagSet,
  type FleetStatus,
  type FleetThresholds,
} from "../../../../src/features/live-tracking-v2/fleet-status";

/** Consecutive fixes required before an overspeed starts or clears. */
export const OVERSPEED_CONFIRM_SAMPLES = 3;
/** Battery must climb this far back above the limit before "recovered" fires. */
export const BATTERY_RECOVERY_MARGIN_PCT = 5;

const COOLDOWN_MS: Partial<Record<FleetEventKey, number>> = {
  "movement.started": 30_000,
  "movement.stopped": 30_000,
  "idle.sustained": 15 * 60_000,
  "overspeed.start": 60_000,
  "overspeed.end": 60_000,
  "battery.low": 30 * 60_000,
  "battery.recovered": 30 * 60_000,
  "gps.offline": 5 * 60_000,
  "gps.restored": 5 * 60_000,
  "zone.exit": 2 * 60_000,
  "zone.entry": 2 * 60_000,
  "range.exit": 2 * 60_000,
  "range.entry": 2 * 60_000,
  "shift.late": 6 * 60 * 60_000,
  "shift.overrun": 60 * 60_000,
  "gps.mocked": 30 * 60_000,
};

/**
 * Keys that share one cooldown bucket. A boundary crossing is a single concept, so
 * an exit and the entry that follows it must not each get their own budget —
 * otherwise a driver hovering on a zone edge still writes a pair of rows every two
 * minutes, which is the flapping the cooldown exists to stop.
 *
 * Deliberately not applied to `gps.*` or `overspeed.*`: there the paired event is
 * the good news, and delaying "restored" or "ended" would leave the feed asserting
 * a problem that has already gone away.
 */
const COOLDOWN_GROUP: Partial<Record<FleetEventKey, string>> = {
  "zone.exit": "zone",
  "zone.entry": "zone",
  "range.exit": "range",
  "range.entry": "range",
};

export type RuleState = {
  status: FleetStatus | null;
  overspeedSamples: number;
  belowLimitSamples: number;
  overspeeding: boolean;
  peakSpeedKmh: number;
  lowBattery: boolean;
  idleSinceMs: number | null;
  idleReported: boolean;
  gpsOffline: boolean;
  /** Debounced assigned-zone membership; null until the first fix. */
  zoneInside: boolean | null;
  /** Delivery-range proximity as last seen; null until the first verdict. */
  rangeInside: boolean | null;
  shiftLateReported: boolean;
  shiftOverrunReported: boolean;
  mockedReported: boolean;
  cooldowns: Record<string, number>;
};

export function initialRuleState(): RuleState {
  return {
    status: null,
    overspeedSamples: 0,
    belowLimitSamples: 0,
    overspeeding: false,
    peakSpeedKmh: 0,
    lowBattery: false,
    idleSinceMs: null,
    idleReported: false,
    gpsOffline: false,
    zoneInside: null,
    rangeInside: null,
    shiftLateReported: false,
    shiftOverrunReported: false,
    mockedReported: false,
    cooldowns: {},
  };
}

export type FleetEventDraft = {
  eventKey: FleetEventKey;
  severity: FleetEventSeverity;
  value: number | null;
  statusBefore: string | null;
  statusAfter: string | null;
  zoneId: string | null;
  latitude: number | null;
  longitude: number | null;
  context: Record<string, unknown>;
  detectedAt: string;
};

export type RuleInput = {
  signals: FleetEntitySignals;
  /** Assigned zone the driver is measured against, if any. */
  assignedZoneId: string | null;
  latitude: number | null;
  longitude: number | null;
  nowMs: number;
  thresholds?: Partial<FleetThresholds> | null;
};

export type RuleOutcome = {
  state: RuleState;
  status: FleetStatus;
  flags: FleetFlagSet;
  events: FleetEventDraft[];
};

/**
 * Runs on every ingest and on every idle tick. Being tick-driven as well as
 * ingest-driven is what lets `gps.offline` fire at all: a driver whose phone has
 * stopped reporting produces no ingest to react to.
 */
export function evaluateRules(previous: RuleState, input: RuleInput): RuleOutcome {
  const thresholds = resolveFleetThresholds(input.thresholds);
  const state: RuleState = { ...previous, cooldowns: { ...previous.cooldowns } };
  const events: FleetEventDraft[] = [];
  const nowMs = input.nowMs;
  const detectedAt = new Date(nowMs).toISOString();

  const status = fleetStatus(input.signals, nowMs, thresholds);
  const flags = fleetFlags(input.signals, nowMs, thresholds);
  const statusBefore = state.status;

  // First observation of a driver is a baseline, not a transition. A room that has
  // just cold-started must not announce that everyone it can see went offline,
  // started speeding or entered a zone at the instant it booted — none of those
  // things happened then, and the timestamp would be a lie.
  if (statusBefore === null) {
    return {
      state: seedBaseline(state, input, status, flags, thresholds, nowMs),
      status,
      flags,
      events,
    };
  }

  const emit = (
    eventKey: FleetEventKey,
    value: number | null,
    context: Record<string, unknown> = {},
  ) => {
    const bucket = COOLDOWN_GROUP[eventKey] ?? eventKey;
    const readyAt = state.cooldowns[bucket] ?? 0;
    if (nowMs < readyAt) return false;
    const cooldown = COOLDOWN_MS[eventKey] ?? 0;
    if (cooldown > 0) state.cooldowns[bucket] = nowMs + cooldown;
    events.push({
      eventKey,
      severity: fleetEventSeverity(eventKey),
      value,
      statusBefore,
      statusAfter: status,
      zoneId: input.assignedZoneId,
      latitude: input.latitude,
      longitude: input.longitude,
      context,
      detectedAt,
    });
    return true;
  };

  // --- movement -------------------------------------------------------------
  const wasMoving = statusBefore === "moving" || statusBefore === "on_delivery";
  const isMoving = status === "moving" || status === "on_delivery";
  if (isMoving !== wasMoving) {
    if (isMoving) {
      emit(FLEET_EVENT_KEYS.movementStarted, speedKmh(input.signals.speedMps));
    } else if (status === "idle") {
      emit(FLEET_EVENT_KEYS.movementStopped, 0);
    }
  }

  // --- sustained idle -------------------------------------------------------
  if (status === "idle") {
    if (state.idleSinceMs == null) {
      state.idleSinceMs = nowMs;
      state.idleReported = false;
    }
    const idleMinutes = (nowMs - state.idleSinceMs) / 60_000;
    if (!state.idleReported && idleMinutes >= thresholds.idleMinutes) {
      // Reported once per idle spell, not once per threshold crossing: a driver
      // idle for an hour is one fact, not twelve.
      if (emit(FLEET_EVENT_KEYS.idleSustained, Math.round(idleMinutes))) {
        state.idleReported = true;
      }
    }
  } else {
    state.idleSinceMs = null;
    state.idleReported = false;
  }

  // --- overspeed ------------------------------------------------------------
  const speeding = isOverspeeding(input.signals.speedMps, thresholds);
  if (speeding) {
    state.overspeedSamples += 1;
    state.belowLimitSamples = 0;
    state.peakSpeedKmh = Math.max(state.peakSpeedKmh, speedKmh(input.signals.speedMps) ?? 0);
  } else {
    state.belowLimitSamples += 1;
    state.overspeedSamples = 0;
  }

  if (!state.overspeeding && state.overspeedSamples >= OVERSPEED_CONFIRM_SAMPLES) {
    if (
      emit(FLEET_EVENT_KEYS.overspeedStart, speedKmh(input.signals.speedMps), {
        limit_kmh: thresholds.overspeedKmh,
        samples: state.overspeedSamples,
      })
    ) {
      state.overspeeding = true;
    }
  } else if (state.overspeeding && state.belowLimitSamples >= OVERSPEED_CONFIRM_SAMPLES) {
    emit(FLEET_EVENT_KEYS.overspeedEnd, state.peakSpeedKmh, {
      limit_kmh: thresholds.overspeedKmh,
      peak_kmh: state.peakSpeedKmh,
    });
    state.overspeeding = false;
    state.peakSpeedKmh = 0;
  }

  // --- battery --------------------------------------------------------------
  const battery = normalizeBatteryPct(input.signals.batteryPct);
  if (battery != null) {
    const low = isLowBattery(battery, thresholds);
    if (!state.lowBattery && low) {
      if (emit(FLEET_EVENT_KEYS.batteryLow, battery, { limit_pct: thresholds.lowBatteryPct })) {
        state.lowBattery = true;
      }
    } else if (
      state.lowBattery &&
      battery >= thresholds.lowBatteryPct + BATTERY_RECOVERY_MARGIN_PCT
    ) {
      // The margin is the hysteresis: a phone hovering at 20% charging and
      // discharging would otherwise emit a pair of events per minute.
      emit(FLEET_EVENT_KEYS.batteryRecovered, battery);
      state.lowBattery = false;
    }
  }

  // --- gps liveness ---------------------------------------------------------
  const gpsOffline = status === "gps_offline" || status === "location_off";
  if (gpsOffline !== state.gpsOffline) {
    // Only meaningful for a driver who is supposed to be reporting.
    if (input.signals.isOnDuty) {
      if (gpsOffline) {
        emit(FLEET_EVENT_KEYS.gpsOffline, null, {
          reason: status === "location_off" ? "location_off" : "silent",
          threshold_seconds: thresholds.gpsOfflineSeconds,
        });
      } else {
        emit(FLEET_EVENT_KEYS.gpsRestored, null);
      }
    }
    state.gpsOffline = gpsOffline;
  }

  // --- assigned zone --------------------------------------------------------
  // `signals.inAssignedZone` is already debounced by the caller (see
  // `debouncedMembership`), so a flip here is a real crossing.
  const zoneInside = input.signals.inAssignedZone ?? null;
  if (zoneInside !== null && input.assignedZoneId) {
    if (state.zoneInside !== null && zoneInside !== state.zoneInside) {
      emit(
        zoneInside ? FLEET_EVENT_KEYS.zoneEntry : FLEET_EVENT_KEYS.zoneExit,
        null,
        { basis: "assigned_zone", buffer_meters: thresholds.zoneBufferMeters },
      );
    }
    state.zoneInside = zoneInside;
  }

  // --- delivery range -------------------------------------------------------
  // Distinct from the assigned zone: this is `driver_locations.zone_status`, the
  // restaurant proximity verdict the app also gates pickup on. An operator needs
  // both, because a driver can be inside their zone and still nowhere near the
  // restaurant they are collecting from.
  const rangeStatus = input.signals.rangeStatus;
  if (rangeStatus === "in_zone" || rangeStatus === "out_of_zone") {
    const rangeInside = rangeStatus === "in_zone";
    if (state.rangeInside !== null && rangeInside !== state.rangeInside) {
      emit(
        rangeInside ? FLEET_EVENT_KEYS.rangeEntry : FLEET_EVENT_KEYS.rangeExit,
        null,
        { basis: "delivery_range" },
      );
    }
    state.rangeInside = rangeInside;
  }

  // --- shift --------------------------------------------------------------
  if (flags.shift_late && !state.shiftLateReported) {
    if (
      emit(FLEET_EVENT_KEYS.shiftLate, null, {
        scheduled_start: isoOrNull(input.signals.shiftScheduledStartMs),
        grace_minutes: thresholds.shiftLateGraceMinutes,
      })
    ) {
      state.shiftLateReported = true;
    }
  }
  if (!flags.shift_late) state.shiftLateReported = false;

  if (flags.shift_overrun && !state.shiftOverrunReported) {
    if (
      emit(FLEET_EVENT_KEYS.shiftOverrun, null, {
        scheduled_end: isoOrNull(input.signals.shiftScheduledEndMs),
      })
    ) {
      state.shiftOverrunReported = true;
    }
  }
  if (!flags.shift_overrun) state.shiftOverrunReported = false;

  // --- mocked provider ------------------------------------------------------
  if (flags.mocked_gps && !state.mockedReported) {
    if (emit(FLEET_EVENT_KEYS.mockedGps, null)) state.mockedReported = true;
  }
  if (!flags.mocked_gps) state.mockedReported = false;

  state.status = status;

  return { state, status, flags, events };
}

function seedBaseline(
  state: RuleState,
  input: RuleInput,
  status: FleetStatus,
  flags: FleetFlagSet,
  thresholds: FleetThresholds,
  nowMs: number,
): RuleState {
  const rangeStatus = input.signals.rangeStatus;
  return {
    ...state,
    status,
    overspeeding: isOverspeeding(input.signals.speedMps, thresholds),
    overspeedSamples: 0,
    belowLimitSamples: 0,
    peakSpeedKmh: 0,
    lowBattery: isLowBattery(input.signals.batteryPct, thresholds),
    // An already-idle driver starts their idle clock now rather than being credited
    // with however long the room happened to be down.
    idleSinceMs: status === "idle" ? nowMs : null,
    idleReported: false,
    gpsOffline: status === "gps_offline" || status === "location_off",
    zoneInside: input.signals.inAssignedZone ?? null,
    rangeInside:
      rangeStatus === "in_zone" ? true : rangeStatus === "out_of_zone" ? false : null,
    shiftLateReported: flags.shift_late,
    shiftOverrunReported: flags.shift_overrun,
    mockedReported: flags.mocked_gps,
  };
}

function speedKmh(speedMps: number | null | undefined): number | null {
  if (speedMps == null || !Number.isFinite(speedMps)) return null;
  return Math.round(speedMps * 3.6 * 10) / 10;
}

function isoOrNull(ms: number | null | undefined): string | null {
  return ms == null || !Number.isFinite(ms) ? null : new Date(ms).toISOString();
}
