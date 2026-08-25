/**
 * Shared status vocabulary for Live Tracking V2.
 *
 * Imported by both the browser bundle and the Cloudflare Worker (`infra/workers/dpd-live`),
 * so this module must stay free of any import — no `@/` aliases, no React, no Node builtins.
 *
 * Deliberately independent of v1 `features/live-tracking/tracking-status.tsx`: v1 flattens duty,
 * zone, speed and delivery into one enum, which is why an out-of-zone moving driver loses its
 * Moving colour there. Here a driver has exactly one `status` plus any number of `flags`.
 */

export type FleetTrackingStatus = "idle" | "moving" | "delivery_submit";

/** Delivery-range proximity (`driver_locations.zone_status`), not the assigned-zone polygon. */
export type FleetRangeStatus = "in_zone" | "out_of_zone" | "unknown";

/**
 * One value per driver, first match wins. Ordered most to least severe so a blocked driver
 * never reads as Moving.
 */
export type FleetStatus =
  | "blocked"
  | "inactive"
  | "offline"
  | "location_off"
  | "gps_offline"
  | "on_break"
  | "on_delivery"
  | "moving"
  | "idle";

/**
 * Independent of each other and of `status`. A driver can be `moving` while
 * `out_of_zone` and `overspeed` at the same time — that combination is precisely
 * what an operator most needs to see.
 */
export type FleetFlag =
  | "on_duty"
  | "online"
  | "out_of_zone"
  | "out_of_range"
  | "overspeed"
  | "low_battery"
  | "stale_gps"
  | "mocked_gps"
  | "shift_late"
  | "shift_overrun";

export type FleetFlagSet = Readonly<Record<FleetFlag, boolean>>;

export const FLEET_STATUSES: readonly FleetStatus[] = [
  "blocked",
  "inactive",
  "offline",
  "location_off",
  "gps_offline",
  "on_break",
  "on_delivery",
  "moving",
  "idle",
];

export const FLEET_FLAGS: readonly FleetFlag[] = [
  "on_duty",
  "online",
  "out_of_zone",
  "out_of_range",
  "overspeed",
  "low_battery",
  "stale_gps",
  "mocked_gps",
  "shift_late",
  "shift_overrun",
];

/**
 * `on_break` has no emitter anywhere in the app, database or docs yet. It is reserved in the
 * enum and the wire format so adding it later is not a schema change; the UI shows it behind a
 * "Coming soon" pill.
 */
export const FLEET_RESERVED_STATUSES: readonly FleetStatus[] = ["on_break"];

export function isReservedFleetStatus(status: FleetStatus): boolean {
  return FLEET_RESERVED_STATUSES.includes(status);
}

/** Statuses offered as filter chips and the map legend, in display order. */
export const FLEET_FILTER_STATUSES: readonly FleetStatus[] = [
  "moving",
  "on_delivery",
  "idle",
  "location_off",
  "gps_offline",
  "offline",
  "blocked",
];

export type FleetThresholds = {
  /** Matches the driver app's AdaptiveLocationScheduler.movingSpeedThresholdMps. */
  movingSpeedMps: number;
  overspeedKmh: number;
  /** Battery at or below this is low. */
  lowBatteryPct: number;
  /**
   * GPS silent for longer than this counts as `gps_offline`, for a driver on the app's
   * *moving* cadence of one fix per second. 90s is 90 missed reports, so it is decisive;
   * v1's 8 minutes was calibrated for 45–60s idle heartbeats and is far too slow here.
   */
  gpsOfflineSeconds: number;
  /**
   * The same verdict for a driver on the app's *idle* cadence of one fix per 30s.
   *
   * A single threshold cannot serve both. `AdaptiveLocationScheduler` reports every 1s while
   * moving and every 30s otherwise, so 90s of silence is 90 missed reports for one and *three*
   * for the other — and three is inside the noise of one Android doze window or one dropped
   * request. A parked, alive, on-duty rider was reading GPS Offline for that reason alone.
   * 150s is five missed idle beats: still well under the time an operator would call a rider
   * about, and no longer reachable by ordinary jitter.
   */
  gpsOfflineIdleSeconds: number;
  /** Warning tier before `gps_offline`: GPS is late but the driver is still shown live. */
  staleGpsSeconds: number;
  /**
   * The warning tier for the idle cadence, and it exists for a sharper reason than its
   * `gps_offline` counterpart: at a 30s cadence a 30s warning is *always* true. Fix age
   * oscillates 0–30s and crosses the line on every single beat, so every idle driver in the
   * fleet carried a permanent `stale_gps` flag, which is the same as having no flag at all.
   */
  staleGpsIdleSeconds: number;
  /** Sustained idle before an idle event is emitted (minutes). */
  idleMinutes: number;
  /** Hysteresis buffer for zone entry/exit so boundary hovering does not flap. */
  zoneBufferMeters: number;
  /** Grace after scheduled shift start before `shift_late`. */
  shiftLateGraceMinutes: number;
};

export const FLEET_DEFAULT_THRESHOLDS: FleetThresholds = {
  movingSpeedMps: 1.5,
  overspeedKmh: 60,
  lowBatteryPct: 20,
  gpsOfflineSeconds: 90,
  gpsOfflineIdleSeconds: 150,
  staleGpsSeconds: 30,
  staleGpsIdleSeconds: 75,
  idleMinutes: 5,
  zoneBufferMeters: 25,
  shiftLateGraceMinutes: 10,
};

export function resolveFleetThresholds(
  overrides?: Partial<FleetThresholds> | null,
): FleetThresholds {
  if (!overrides) return FLEET_DEFAULT_THRESHOLDS;
  const merged = { ...FLEET_DEFAULT_THRESHOLDS };
  for (const key of Object.keys(FLEET_DEFAULT_THRESHOLDS) as (keyof FleetThresholds)[]) {
    const value = overrides[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * The one mapping between `FleetThresholds` and the snake_case `settings` bag carried by the
 * room's `hello` frame, its snapshots and `app_settings`.
 *
 * Both directions are derived from this object because they used to be four hand-written
 * lists — one in the Worker's serialiser, one in the Worker's settings read, and two in the
 * store — and adding a threshold to the type does not make it travel. `resolveFleetThresholds`
 * falls back to the default for anything absent, so a list that missed a key failed *silently*:
 * the Worker would enforce a new value while the browser kept the old one, which is exactly the
 * drift this shared module exists to prevent. The duplication had already begun to show, too —
 * one of the store's two copies mapped `movingSpeedMps` and the other did not.
 */
const THRESHOLD_SETTING_KEYS: Readonly<Record<keyof FleetThresholds, string>> = {
  movingSpeedMps: "moving_speed_mps",
  overspeedKmh: "overspeed_kmh",
  lowBatteryPct: "low_battery_pct",
  gpsOfflineSeconds: "gps_offline_seconds",
  gpsOfflineIdleSeconds: "gps_offline_idle_seconds",
  staleGpsSeconds: "stale_gps_seconds",
  staleGpsIdleSeconds: "stale_gps_idle_seconds",
  idleMinutes: "idle_minutes",
  zoneBufferMeters: "zone_buffer_meters",
  shiftLateGraceMinutes: "shift_late_grace_minutes",
};

const THRESHOLD_KEYS = Object.keys(THRESHOLD_SETTING_KEYS) as (keyof FleetThresholds)[];

/** Read a settings bag (`hello` frame, snapshot, `app_settings`) into resolved thresholds. */
export function fleetThresholdsFromSettings(
  settings?: Record<string, number | null | undefined> | null,
): FleetThresholds {
  if (!settings) return FLEET_DEFAULT_THRESHOLDS;
  const overrides: Partial<FleetThresholds> = {};
  for (const key of THRESHOLD_KEYS) {
    const value = settings[THRESHOLD_SETTING_KEYS[key]];
    if (typeof value === "number") overrides[key] = value;
  }
  return resolveFleetThresholds(overrides);
}

/** Serialise thresholds back into the settings bag clients receive. */
export function fleetThresholdsAsSettings(
  thresholds: FleetThresholds,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of THRESHOLD_KEYS) {
    out[THRESHOLD_SETTING_KEYS[key]] = thresholds[key];
  }
  return out;
}

export type FleetEntitySignals = {
  isBlocked?: boolean | null;
  /** `drivers.status` — anything other than `active` reads as Inactive. */
  accountStatus?: string | null;
  isOnDuty: boolean;
  isOnline?: boolean | null;
  /** Reserved: no emitter yet. */
  onBreak?: boolean | null;
  /** True once `driver_clear_live_location` has removed the pin (OS location off, on duty). */
  locationOff?: boolean | null;
  /** Epoch ms of the freshest GPS signal (prefer `last_report_at` over `last_seen_at`). */
  lastFixAtMs: number | null;
  trackingStatus: FleetTrackingStatus;
  speedMps?: number | null;
  activeDeliveryId?: string | null;
  batteryPct?: number | null;
  isMocked?: boolean | null;
  /** Assigned-zone polygon membership, computed from geometry rather than read from the row. */
  inAssignedZone?: boolean | null;
  /** Delivery-range proximity as stored in `driver_locations.zone_status`. */
  rangeStatus?: FleetRangeStatus | null;
  shiftScheduledStartMs?: number | null;
  shiftScheduledEndMs?: number | null;
  shiftCheckInAtMs?: number | null;
};

export function gpsAgeSeconds(
  lastFixAtMs: number | null | undefined,
  nowMs: number,
): number | null {
  if (lastFixAtMs == null || !Number.isFinite(lastFixAtMs)) return null;
  const age = (nowMs - lastFixAtMs) / 1000;
  return age >= 0 ? age : 0;
}

export function isMovingSpeed(
  speedMps: number | null | undefined,
  thresholds: FleetThresholds = FLEET_DEFAULT_THRESHOLDS,
): boolean {
  return (
    speedMps != null &&
    Number.isFinite(speedMps) &&
    speedMps >= thresholds.movingSpeedMps
  );
}

/**
 * Which reporting cadence the driver app was on when it produced this fix, which is what
 * decides how long silence has to last before it means anything.
 *
 * `AdaptiveLocationScheduler` picks its interval from its own tracking status, and that status
 * rides along with every fix — so this is a read of the app's behaviour, not a guess at it.
 * `delivery_submit` counts as idle because the scheduler reports it once, immediately, and then
 * resets itself to `idle` in `markSampled`: a rider waiting at a pickup is on the 30s beat.
 * Speed is consulted as well as the status because a fix can carry real motion while the
 * scheduler has not yet promoted itself out of idle.
 */
function usesIdleCadence(
  trackingStatus: FleetTrackingStatus,
  speedMps: number | null | undefined,
  thresholds: FleetThresholds,
): boolean {
  if (trackingStatus === "moving") return false;
  return !isMovingSpeed(speedMps, thresholds);
}

/**
 * Seconds of GPS silence that make a driver `gps_offline`, given the cadence their last fix
 * was reported at. Exported in this primitive form as well as the `FleetEntitySignals` one
 * below because v1 Live Tracking needs the same rule from a row that is not a signals object.
 */
export function gpsOfflineGraceSecondsFor(
  trackingStatus: FleetTrackingStatus,
  speedMps: number | null | undefined,
  thresholds: FleetThresholds = FLEET_DEFAULT_THRESHOLDS,
): number {
  return usesIdleCadence(trackingStatus, speedMps, thresholds)
    ? thresholds.gpsOfflineIdleSeconds
    : thresholds.gpsOfflineSeconds;
}

export function gpsOfflineGraceSeconds(
  signals: FleetEntitySignals,
  thresholds: FleetThresholds,
): number {
  return gpsOfflineGraceSecondsFor(
    signals.trackingStatus,
    signals.speedMps,
    thresholds,
  );
}

/** Seconds of GPS silence that raise `stale_gps`, given their cadence. */
function staleGpsGraceSeconds(
  signals: FleetEntitySignals,
  thresholds: FleetThresholds,
): number {
  return usesIdleCadence(signals.trackingStatus, signals.speedMps, thresholds)
    ? thresholds.staleGpsIdleSeconds
    : thresholds.staleGpsSeconds;
}

/**
 * Speed shown on a card or KPI. GPS rest jitter below the moving threshold is 0 km/h,
 * matching the driver app — otherwise an Idle rider reads "1 km/h" from a 0.3 m/s wobble.
 */
export function displaySpeedKmh(
  speedMps: number | null | undefined,
  thresholds?: FleetThresholds,
  status?: FleetStatus,
): number {
  if (speedMps == null || !Number.isFinite(speedMps) || speedMps < 0) return 0;
  const resolved = resolveFleetThresholds(thresholds);
  // A Moving / On Delivery stamp is already the motion claim; flooring it to 0 km/h
  // because GPS is briefly under 1.5 m/s is what made a moving rider read as parked.
  if (status !== "moving" && status !== "on_delivery" && speedMps < resolved.movingSpeedMps) {
    return 0;
  }
  return Math.round(speedMps * 3.6);
}

export function isOverspeeding(
  speedMps: number | null | undefined,
  thresholds: FleetThresholds = FLEET_DEFAULT_THRESHOLDS,
): boolean {
  if (speedMps == null || !Number.isFinite(speedMps) || speedMps < 0) return false;
  // Compared in m/s: converting the reading up to km/h makes a driver sitting exactly on the
  // limit read as 60.00000000000001 and flap.
  return speedMps > thresholds.overspeedKmh / 3.6 + 1e-9;
}

/** 0–100 passes through; an exclusive (0,1) fraction is treated as a ratio. */
export function normalizeBatteryPct(pct: number | null | undefined): number | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct > 0 && pct < 1) return Math.round(pct * 100);
  return Math.round(Math.min(100, Math.max(0, pct)));
}

export function isLowBattery(
  pct: number | null | undefined,
  thresholds: FleetThresholds = FLEET_DEFAULT_THRESHOLDS,
): boolean {
  const normalized = normalizeBatteryPct(pct);
  return normalized != null && normalized <= thresholds.lowBatteryPct;
}

/**
 * One status per driver, first match wins.
 *
 * `offline` is checked before `location_off` on purpose: a clocked-out driver reads Offline
 * whatever their permission state, matching the app rule that clock-out keeps the last pin.
 */
export function fleetStatus(
  signals: FleetEntitySignals,
  nowMs: number,
  thresholdOverrides?: Partial<FleetThresholds> | null,
): FleetStatus {
  const thresholds = resolveFleetThresholds(thresholdOverrides);

  if (signals.isBlocked === true) return "blocked";
  if (signals.accountStatus != null && signals.accountStatus !== "active") {
    return "inactive";
  }
  if (!signals.isOnDuty) return "offline";
  if (signals.locationOff === true) return "location_off";

  const age = gpsAgeSeconds(signals.lastFixAtMs, nowMs);
  if (age == null || age > gpsOfflineGraceSeconds(signals, thresholds)) {
    return "gps_offline";
  }

  if (signals.onBreak === true) return "on_break";

  /*
   * An open delivery *is* the status, whether or not the rider happens to be moving.
   *
   * This used to also require `trackingStatus === "delivery_submit"`, which made the status
   * practically unreachable: the app sets `delivery_submit` when a pickup is logged and then
   * the very next position sample overwrites it with `moving` or `idle`, so the admin saw
   * On Delivery for one frame at best. The `activeDeliveryId` half is the durable fact — it
   * now comes from `deliveries.status = 'in_transit'` rather than from whatever the phone
   * happened to attach to a fix — so it can carry the status alone.
   *
   * A leftover `delivery_submit` with no open delivery still falls through to moving/idle by
   * speed, which was the v1 defect this ordering was written to avoid.
   */
  if (signals.activeDeliveryId) return "on_delivery";
  if (signals.trackingStatus === "moving") return "moving";
  if (isMovingSpeed(signals.speedMps, thresholds)) return "moving";
  return "idle";
}

/**
 * Statuses whose position, speed and heading are a *record* of where the driver was, not a
 * claim about where they are.
 *
 * The reason this is keyed on status rather than re-derived from a fix age at each call site
 * is that the status machine has already made exactly this decision: `gps_offline` means the
 * newest fix is older than `gpsOfflineSeconds`, and `offline` / `location_off` mean the pin is
 * deliberately the last known one. A second, independently computed age test beside the status
 * pill is how a card ends up reading "GPS offline · 10 km/h" — which is what it did.
 *
 * `blocked` and `inactive` are included because both paths clock the driver out
 * (`set_driver_blocked`, `drivers_end_duty_on_inactive_status`), so their last reading is by
 * construction from a session that has ended.
 */
const STALE_TELEMETRY_STATUSES: readonly FleetStatus[] = [
  "blocked",
  "inactive",
  "offline",
  "location_off",
  "gps_offline",
];

/** True when speed / heading / zone readings are recent enough to state as fact. */
export function hasLiveTelemetry(status: FleetStatus): boolean {
  return !STALE_TELEMETRY_STATUSES.includes(status);
}

/**
 * The status a driver decays to once their GPS goes quiet, or `null` if this status does not
 * decay.
 *
 * Status normally arrives with a position frame, which means a driver who simply stops
 * reporting keeps whichever status their last frame carried — and the frames stop for exactly
 * the reasons an operator most needs to see. A rider whose phone died at 40 km/h stayed
 * "Moving" on the map until the room next re-read the roster, which is up to a minute later,
 * and on the polling rail until the next 10s snapshot. Ageing on the client's own clock is
 * what makes `gpsOfflineSeconds` mean what it says.
 */
export function decayedFleetStatus(
  status: FleetStatus,
  lastFixAtMs: number | null,
  nowMs: number,
  thresholdOverrides?: Partial<FleetThresholds> | null,
): FleetStatus | null {
  // Only the statuses that assert something live can go stale. `offline` is a duty fact and
  // `blocked` an account fact; neither is a function of how old the last fix is.
  if (
    status !== "moving" &&
    status !== "idle" &&
    status !== "on_delivery" &&
    status !== "on_break"
  ) {
    return null;
  }
  const thresholds = resolveFleetThresholds(thresholdOverrides);
  const age = gpsAgeSeconds(lastFixAtMs, nowMs);
  if (age != null && age <= gpsGraceForStatus(status, thresholds).offline) return null;
  return "gps_offline";
}

/**
 * Cadence-aware grace for a driver we hold a *status* for rather than a fix.
 *
 * The local decay clock runs on an interval with no position in hand, so it cannot read the
 * app's tracking status off a frame the way `usesIdleCadence` does. Only `moving` earns the
 * tight 1Hz grace here: `idle`, `on_delivery` and `on_break` all describe a rider who may be
 * standing still, and a rider waiting at a pickup is on the 30s beat however their delivery is
 * labelled. Erring long merely delays an Offline verdict; erring short invents one, which is
 * the defect this exists to fix.
 */
export function gpsGraceForStatus(
  status: FleetStatus,
  thresholds: FleetThresholds,
): { offline: number; stale: number } {
  if (status === "moving") {
    return { offline: thresholds.gpsOfflineSeconds, stale: thresholds.staleGpsSeconds };
  }
  return {
    offline: thresholds.gpsOfflineIdleSeconds,
    stale: thresholds.staleGpsIdleSeconds,
  };
}

const EMPTY_FLAGS: FleetFlagSet = {
  on_duty: false,
  online: false,
  out_of_zone: false,
  out_of_range: false,
  overspeed: false,
  low_battery: false,
  stale_gps: false,
  mocked_gps: false,
  shift_late: false,
  shift_overrun: false,
};

/** True when the driver's GPS is recent enough to trust positional claims. */
function hasLiveFix(
  signals: FleetEntitySignals,
  nowMs: number,
  thresholds: FleetThresholds,
): boolean {
  const age = gpsAgeSeconds(signals.lastFixAtMs, nowMs);
  return age != null && age <= gpsOfflineGraceSeconds(signals, thresholds);
}

export function fleetFlags(
  signals: FleetEntitySignals,
  nowMs: number,
  thresholdOverrides?: Partial<FleetThresholds> | null,
): FleetFlagSet {
  const thresholds = resolveFleetThresholds(thresholdOverrides);
  const live = hasLiveFix(signals, nowMs, thresholds);
  const age = gpsAgeSeconds(signals.lastFixAtMs, nowMs);

  // Zone claims require a live fix. Reporting a stale "in zone" for a driver whose phone died
  // an hour ago is worse than reporting nothing.
  const outOfZone = live && signals.inAssignedZone === false;
  const outOfRange = live && signals.rangeStatus === "out_of_zone";

  return {
    on_duty: signals.isOnDuty === true,
    online: signals.isOnline === true,
    out_of_zone: outOfZone,
    out_of_range: outOfRange,
    overspeed: live && isOverspeeding(signals.speedMps, thresholds),
    low_battery: isLowBattery(signals.batteryPct, thresholds),
    // Only a warning tier: once the driver is past their offline grace the status says so.
    stale_gps:
      live && age != null && age > staleGpsGraceSeconds(signals, thresholds),
    mocked_gps: signals.isMocked === true,
    ...shiftFlags(signals, nowMs, thresholds),
  };
}

function shiftFlags(
  signals: FleetEntitySignals,
  nowMs: number,
  thresholds: FleetThresholds,
): { shift_late: boolean; shift_overrun: boolean } {
  const start = signals.shiftScheduledStartMs;
  const end = signals.shiftScheduledEndMs;
  const graceMs = thresholds.shiftLateGraceMinutes * 60_000;

  let late = false;
  if (start != null && Number.isFinite(start) && nowMs > start + graceMs) {
    const checkIn = signals.shiftCheckInAtMs;
    // Late if they never clocked in, or clocked in after the grace window closed.
    late = checkIn == null || !Number.isFinite(checkIn) || checkIn > start + graceMs;
  }

  const overrun =
    end != null && Number.isFinite(end) && nowMs > end && signals.isOnDuty === true;

  return { shift_late: late, shift_overrun: overrun };
}

export function emptyFleetFlags(): FleetFlagSet {
  return EMPTY_FLAGS;
}

export function activeFleetFlags(flags: FleetFlagSet): FleetFlag[] {
  return FLEET_FLAGS.filter((flag) => flags[flag]);
}

/**
 * Flags that mean "needs attention now", as opposed to `on_duty` / `online` which are merely
 * descriptive. Drives the Alerts KPI — not the status-distribution bar, which counts by
 * status so an out-of-zone Moving rider still reads as Moving.
 */
export const FLEET_ALERT_FLAGS: readonly FleetFlag[] = [
  "out_of_zone",
  "out_of_range",
  "overspeed",
  "mocked_gps",
  "shift_overrun",
];

export function isFleetAlert(status: FleetStatus, flags: FleetFlagSet): boolean {
  if (status === "blocked" || status === "inactive") return true;
  return FLEET_ALERT_FLAGS.some((flag) => flags[flag]);
}

export type FleetTone = "success" | "primary" | "warning" | "danger" | "neutral";

const STATUS_TONES: Record<FleetStatus, FleetTone> = {
  blocked: "danger",
  inactive: "danger",
  offline: "danger",
  location_off: "warning",
  gps_offline: "danger",
  on_break: "primary",
  on_delivery: "primary",
  moving: "success",
  idle: "warning",
};

/**
 * Status tone is independent of flags on purpose. v1 turned an out-of-zone Moving driver grey
 * or red and lost the movement signal; here the status keeps its colour and the flag adds a
 * badge beside it.
 */
export function fleetStatusTone(status: FleetStatus): FleetTone {
  return STATUS_TONES[status];
}

/**
 * Map puck colour. Status keeps its chip colour on the rail (a Moving rider who left
 * range is still Moving); the marker itself goes red so the map matches the alert.
 */
export function fleetMarkerTone(status: FleetStatus, flags: FleetFlagSet): FleetTone {
  if (flags.out_of_zone || flags.out_of_range) return "danger";
  return fleetStatusTone(status);
}

const FLAG_TONES: Record<FleetFlag, FleetTone> = {
  on_duty: "neutral",
  online: "success",
  out_of_zone: "danger",
  out_of_range: "danger",
  overspeed: "danger",
  low_battery: "warning",
  stale_gps: "warning",
  mocked_gps: "danger",
  shift_late: "warning",
  shift_overrun: "warning",
};

export function fleetFlagTone(flag: FleetFlag): FleetTone {
  return FLAG_TONES[flag];
}

/** Buckets for the status distribution bar. Alert is computed, not a status. */
export type FleetDistributionBucket =
  | "moving"
  | "on_delivery"
  | "idle"
  | "offline"
  | "alert";

export const FLEET_DISTRIBUTION_BUCKETS: readonly FleetDistributionBucket[] = [
  "moving",
  "on_delivery",
  "idle",
  "offline",
  "alert",
];

/**
 * What the Insights stacked bar actually paints. Status slices stay exclusive
 * (`fleetDistributionBucket`); Alert is the KPI overlay (`kpis.alerts`) so an
 * out-of-zone Moving rider still widens the emerald segment *and* the rose one.
 */
export function fleetDistributionBarSegments(
  counts: Record<FleetDistributionBucket, number>,
  alerts: number,
): { bucket: FleetDistributionBucket; count: number }[] {
  return FLEET_DISTRIBUTION_BUCKETS.map((bucket) => ({
    bucket,
    count: bucket === "alert" ? alerts : counts[bucket],
  }));
}

export function fleetDistributionBucket(
  status: FleetStatus,
  flags: FleetFlagSet,
): FleetDistributionBucket {
  // Status wins. An out-of-zone Moving rider is still Moving — putting them in Alert
  // first is why Fleet Insights reported Moving = 0 while the rail still said Moving.
  // Alert stays a KPI (`isFleetAlert`), not a competing slice of this bar.
  if (status === "moving") return "moving";
  if (status === "on_delivery") return "on_delivery";
  if (status === "idle" || status === "on_break") return "idle";
  if (isFleetAlert(status, flags)) return "alert";
  return "offline";
}

/** Sort order for the driver rail: things needing attention first, dormant drivers last. */
const STATUS_SORT_WEIGHT: Record<FleetStatus, number> = {
  blocked: 0,
  inactive: 1,
  on_delivery: 2,
  moving: 3,
  idle: 4,
  on_break: 5,
  location_off: 6,
  gps_offline: 7,
  offline: 8,
};

export function fleetStatusSortWeight(status: FleetStatus): number {
  return STATUS_SORT_WEIGHT[status];
}

/**
 * Event keys written to `fleet_events`. Class B only — derived from the position stream.
 * Class A driver actions stay in `driver_operation_events` and are relayed, never re-emitted.
 */
export const FLEET_EVENT_KEYS = {
  movementStarted: "movement.started",
  movementStopped: "movement.stopped",
  idleSustained: "idle.sustained",
  overspeedStart: "overspeed.start",
  overspeedEnd: "overspeed.end",
  batteryLow: "battery.low",
  batteryRecovered: "battery.recovered",
  gpsOffline: "gps.offline",
  gpsRestored: "gps.restored",
  zoneExit: "zone.exit",
  zoneEntry: "zone.entry",
  rangeExit: "range.exit",
  rangeEntry: "range.entry",
  shiftLate: "shift.late",
  shiftOverrun: "shift.overrun",
  mockedGps: "gps.mocked",
} as const;

export type FleetEventKey = (typeof FLEET_EVENT_KEYS)[keyof typeof FLEET_EVENT_KEYS];

export type FleetEventSeverity = "info" | "warning" | "critical";

const EVENT_SEVERITY: Record<FleetEventKey, FleetEventSeverity> = {
  "movement.started": "info",
  "movement.stopped": "info",
  "idle.sustained": "warning",
  "overspeed.start": "critical",
  "overspeed.end": "info",
  "battery.low": "warning",
  "battery.recovered": "info",
  "gps.offline": "warning",
  "gps.restored": "info",
  "zone.exit": "critical",
  "zone.entry": "info",
  "range.exit": "warning",
  "range.entry": "info",
  "shift.late": "warning",
  "shift.overrun": "warning",
  "gps.mocked": "critical",
};

export function fleetEventSeverity(key: FleetEventKey): FleetEventSeverity {
  return EVENT_SEVERITY[key] ?? "info";
}

export function fleetEventTone(severity: FleetEventSeverity): FleetTone {
  if (severity === "critical") return "danger";
  if (severity === "warning") return "warning";
  return "neutral";
}
