/**
 * The client's fleet state, and the two-tier subscription model that lets 500
 * drivers update four times a second without React re-rendering 500 components.
 *
 * Tier 1 (`subscribe`) fires on *structural* change only — roster, status, filters,
 * connection, feed. That is what the KPI tiles, the distribution bar and the rail's
 * id list read.
 *
 * Tier 2 (`subscribeDriver`) fires per driver, throttled, and is what an individual
 * rail card reads. A card showing speed and battery therefore re-renders on its own
 * schedule, and a card scrolled out of the virtualized window re-renders not at all.
 *
 * Positions are deliberately *not* in either tier: the map reads them straight from
 * the interpolator inside its own animation frame. Routing 4Hz coordinates through
 * React state is the thing this whole page exists to avoid.
 *
 * Not zustand/redux: the point is the two tiers, and a single external store with
 * `useSyncExternalStore` expresses that in less code than configuring a library to
 * behave this way.
 */

import {
  FLEET_DISTRIBUTION_BUCKETS,
  activeFleetFlags,
  decayedFleetStatus,
  emptyFleetFlags,
  fleetDistributionBucket,
  fleetEventSeverity,
  fleetFlags,
  fleetStatus,
  fleetStatusSortWeight,
  fleetThresholdsFromSettings,
  gpsAgeSeconds,
  gpsGraceForStatus,
  hasLiveTelemetry,
  isFleetAlert,
  isMovingSpeed,
  normalizeBatteryPct,
  resolveFleetThresholds,
  type FleetDistributionBucket,
  type FleetEventSeverity,
  type FleetStatus,
  type FleetThresholds,
  type FleetTrackingStatus,
} from "./fleet-status";
import { FleetInterpolator } from "./fleet-interpolator";
import { FleetTrailStore } from "./fleet-trail";
import {
  emptyFleetFilters,
  persistFleetFilters,
  readPersistedFleetFilters,
  type FleetConnectionState,
  type FleetDriver,
  type FleetFeedItem,
  type FleetFilters,
  type FleetKpis,
  type FleetRail,
  type FleetSnapshot,
  type FleetZone,
  type FleetZoneCount,
} from "./fleet-types";
import {
  activeFlagsFromBits,
  decodePosition,
  flagBits,
  flagsFromBits,
  flagsFromNames,
  type DriverMeta,
  type FleetEventFrame,
  type HeadingSource,
  type OpsEventFrame,
  type PositionTuple,
  type TrailTrack,
} from "./fleet-wire";
import { composeFleetFeed } from "./fleet-feed";

/** Feed depth. Anything older belongs in the Activity tab, which is paginated. */
const FEED_LIMIT = 250;
/** Per-driver notification throttle. 2Hz is past the point a human reads a number. */
const DRIVER_NOTIFY_MS = 500;

type Listener = () => void;

function sameStatusSet(a: FleetStatus[] | null, b: FleetStatus[] | null): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (a.length !== b.length) return false;
  return a.every((status, index) => status === b[index]);
}

export type FleetSnapshotRow = {
  driver_id: string;
  driver_name: string | null;
  driver_code: string;
  employee_id: string | null;
  avatar_object_key: string | null;
  avatar_updated_at: string | null;
  account_status: string | null;
  is_on_duty: boolean | null;
  is_blocked: boolean | null;
  is_online: boolean | null;
  zone_id: string | null;
  zone_name: string | null;
  partner_id: string | null;
  partner_name: string | null;
  restaurant_name: string | null;
  vehicle_reg_number: string | null;
  vehicle_bike_id: string | null;
  vehicle_type_key?: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  speed_mps: number | string | null;
  heading_deg: number | string | null;
  accuracy_meters: number | string | null;
  battery_pct: number | null;
  is_mocked: boolean | null;
  tracking_status: string | null;
  zone_status: string | null;
  out_of_zone_since: string | null;
  distance_today_meters: number | string | null;
  active_delivery_id: string | null;
  last_seen_at: string | null;
  last_report_at: string | null;
  on_duty_since: string | null;
  deliveries_today: number | null;
  deliveries_completed_today: number | null;
  shift: {
    session1_start_at: string | null;
    session1_end_at: string | null;
    session2_start_at: string | null;
    session2_end_at: string | null;
  } | null;
};

export type FleetMirrorDriver = {
  id: string;
  name: string;
  code: string;
  lat: number;
  lng: number;
  sp: number | null;
  hd: number | null;
  hs?: HeadingSource | null;
  st: string;
  fl: string[];
  age: number | null;
};

export class FleetStore {
  private readonly drivers = new Map<string, FleetDriver>();
  /** Wire id dictionary; only the edge rail populates it. */
  private readonly byIdIdx = new Map<number, string>();

  readonly interpolator = new FleetInterpolator();
  readonly trails = new FleetTrailStore();

  private zones: FleetZone[] = [];
  private thresholds: FleetThresholds = resolveFleetThresholds(null);
  private feed: FleetFeedItem[] = [];
  private heldFeed: FleetFeedItem[] = [];
  private readonly feedIds = new Set<string>();
  private feedPaused = false;
  private filters: FleetFilters = emptyFleetFilters();
  private selectedDriverId: string | null = null;

  private connection: FleetConnectionState = {
    rail: "offline",
    status: "connecting",
    lastFrameAt: 0,
    clockSkewMs: 0,
    frameHz: 4,
    attempts: 0,
    error: null,
  };

  private version = 0;
  private snapshot: FleetSnapshot = this.buildSnapshot();

  private readonly listeners = new Set<Listener>();
  private readonly driverListeners = new Map<string, Set<Listener>>();
  private readonly dirtyDrivers = new Set<string>();
  private driverFlushHandle: ReturnType<typeof setTimeout> | null = null;
  private lastDriverFlushAt = 0;

  /** Called when filters change, so the transport can narrow the socket's interest. */
  onFiltersChanged: ((filters: FleetFilters) => void) | null = null;

  /**
   * Apply the status chips remembered from the operator's last visit.
   *
   * Deliberately not done in the constructor. The store is built during the first
   * client render, so a chip set read from `localStorage` there is a chip set the
   * server could not have rendered — and `useSyncExternalStore` hands that same
   * snapshot to React as the *server* snapshot during hydration, so the mismatch
   * discards the SSR tree and re-renders the whole canvas on the client. The
   * provider calls this from an effect instead, where the DOM is already hydrated
   * and a differing snapshot is just a state change.
   *
   * Call it before starting the transport: the first snapshot fetch and the room's
   * interest should be for the restored chips, not for the full fleet.
   */
  hydratePersistedFilters(): void {
    const persisted = readPersistedFleetFilters();
    if (
      persisted.alertsOnly === this.filters.alertsOnly &&
      sameStatusSet(persisted.statuses, this.filters.statuses)
    ) {
      return;
    }
    this.filters = {
      ...this.filters,
      statuses: persisted.statuses,
      alertsOnly: persisted.alertsOnly,
    };
    this.publish();
  }

  // -------------------------------------------------------------------------
  // React bindings
  // -------------------------------------------------------------------------

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): FleetSnapshot => this.snapshot;

  subscribeDriver(driverId: string, listener: Listener): () => void {
    let set = this.driverListeners.get(driverId);
    if (!set) {
      set = new Set();
      this.driverListeners.set(driverId, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.driverListeners.delete(driverId);
    };
  }

  getDriver(driverId: string): FleetDriver | null {
    return this.drivers.get(driverId) ?? null;
  }

  getAllDrivers(): FleetDriver[] {
    return [...this.drivers.values()];
  }

  getZones(): FleetZone[] {
    return this.zones;
  }

  getThresholds(): FleetThresholds {
    return this.thresholds;
  }

  /** Server clock, which is what interpolation timestamps are in. */
  serverNow(): number {
    return Date.now() + this.connection.clockSkewMs;
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  setFilters(patch: Partial<FleetFilters>): void {
    this.filters = { ...this.filters, ...patch };
    persistFleetFilters(this.filters);
    this.publish();
    this.onFiltersChanged?.(this.filters);
  }

  resetFilters(): void {
    this.filters = emptyFleetFilters();
    persistFleetFilters(this.filters);
    this.publish();
    this.onFiltersChanged?.(this.filters);
  }

  selectDriver(driverId: string | null): void {
    // Toggle: clicking the selected driver again clears, matching the map's
    // same-marker deselect path.
    this.selectedDriverId = this.selectedDriverId === driverId ? null : driverId;
    this.publish();
    this.onFiltersChanged?.(this.filters);
  }

  clearSelection(): void {
    if (this.selectedDriverId == null) return;
    this.selectedDriverId = null;
    this.publish();
    this.onFiltersChanged?.(this.filters);
  }

  setFeedPaused(paused: boolean): void {
    if (paused === this.feedPaused) return;
    this.feedPaused = paused;
    if (!paused && this.heldFeed.length > 0) {
      this.feed = [...this.heldFeed, ...this.feed].slice(0, FEED_LIMIT);
      this.heldFeed = [];
    }
    this.publish();
  }

  setConnection(patch: Partial<FleetConnectionState>): void {
    this.connection = { ...this.connection, ...patch };
    this.publish();
  }

  setRail(rail: FleetRail, status: FleetConnectionState["status"]): void {
    this.setConnection({ rail, status });
  }

  /** Rail switch: drop wire-id mappings, keep drivers and their motion history. */
  resetWireIds(): void {
    this.byIdIdx.clear();
  }

  // -------------------------------------------------------------------------
  // Edge rail
  // -------------------------------------------------------------------------

  applyHello(input: {
    serverTime: number;
    frameHz: number;
    settings: Record<string, number>;
    zones: FleetZone[];
  }): void {
    if (input.zones.length > 0) this.zones = input.zones;
    this.thresholds = fleetThresholdsFromSettings(input.settings);
    this.connection = {
      ...this.connection,
      // One-shot skew estimate. Good enough: the error is half a round trip, and
      // interpolation only needs the clocks to agree to within a frame.
      clockSkewMs: input.serverTime - Date.now(),
      frameHz: input.frameHz,
      rail: "edge",
      status: "live",
      error: null,
    };
    this.publish();
  }

  applyMeta(metas: DriverMeta[]): void {
    for (const meta of metas) {
      this.byIdIdx.set(meta.idIdx, meta.driverId);
      const existing = this.drivers.get(meta.driverId);
      const flags =
        meta.flagBits != null
          ? flagsFromBits(meta.flagBits)
          : (existing?.flags ?? emptyFleetFlags());
      const status = meta.status ?? existing?.status ?? "offline";
      if (existing) {
        this.drivers.set(meta.driverId, {
          ...existing,
          meta,
          idIdx: meta.idIdx,
          status,
          flags,
          activeFlags: activeFleetFlags(flags),
        });
      } else {
        this.drivers.set(meta.driverId, {
          driverId: meta.driverId,
          idIdx: meta.idIdx,
          meta,
          status,
          flags,
          activeFlags: activeFleetFlags(flags),
          lat: null,
          lng: null,
          speedMps: 0,
          headingDeg: 0,
          headingSource: "none",
          fixAtMs: 0,
          gpsAgeMs: 0,
        });
      }
      this.dirtyDrivers.add(meta.driverId);
    }
    this.publish();
    this.scheduleDriverFlush();
  }

  /**
   * History for drivers this socket has just started seeing. The room sends it once
   * per driver; everything after that arrives as ordinary position frames.
   */
  applyTrail(input: { tracks: TrailTrack[] }): void {
    const nowMs = this.serverNow();
    for (const track of input.tracks) {
      const driverId = this.byIdIdx.get(track.idIdx);
      if (!driverId) continue;
      this.trails.hydrate(driverId, track.pts, nowMs);
    }
  }

  applyDelta(input: { ts: number; e: PositionTuple[]; gone: number[] }): void {
    let structural = false;

    for (const tuple of input.e) {
      const decoded = decodePosition(tuple);
      const driverId = this.byIdIdx.get(decoded.idIdx);
      // A position for a driver whose meta has not arrived yet is dropped rather
      // than drawn as an anonymous dot; the meta frame is sent first for exactly
      // this reason, so this only happens across a reconnect.
      if (!driverId) continue;

      const existing = this.drivers.get(driverId);
      if (!existing) continue;

      const fixAtMs = input.ts - decoded.ageMs;
      if (
        existing.status !== decoded.status ||
        tuple[6] !== flagBits(existing.flags)
      ) {
        structural = true;
      }

      // A fix with no bearing keeps the last one. This is the single place that
      // decision is made, so the marker, the interpolator and the driver card cannot
      // disagree about which way a stopped bike is facing — and none of them has to
      // treat "no heading" as "due north".
      const headingDeg = decoded.headingKnown ? decoded.headingDeg : existing.headingDeg;

      const next: FleetDriver = {
        ...existing,
        status: decoded.status,
        flags: decoded.flags,
        activeFlags: activeFlagsFromBits(tuple[6]),
        lat: decoded.lat,
        lng: decoded.lng,
        speedMps: decoded.speedMps,
        headingDeg,
        headingSource: decoded.headingSource,
        fixAtMs,
        gpsAgeMs: decoded.ageMs,
      };
      this.drivers.set(driverId, next);
      this.dirtyDrivers.add(driverId);
      this.trails.append(driverId, decoded.lat, decoded.lng, fixAtMs);

      const sample = {
        lat: decoded.lat,
        lng: decoded.lng,
        headingDeg,
        speedMps: decoded.speedMps,
        tMs: fixAtMs,
      };
      if (existing.lat == null) {
        this.interpolator.reset(driverId, sample);
      } else {
        this.interpolator.push(driverId, sample);
      }
    }

    for (const idIdx of input.gone) {
      // Viewport / filter cull from the room. Keep the roster row so the rail and
      // search still list the driver — dropping them is why an out-of-zone or
      // blocked rider vanished from the sidebar the moment they left the map frame.
      const driverId = this.byIdIdx.get(idIdx);
      if (!driverId) continue;
      this.dirtyDrivers.add(driverId);
      structural = true;
    }

    this.connection = { ...this.connection, lastFrameAt: Date.now(), status: "live" };
    // A pure-position frame changes nothing the KPI tiles or the rail's ordering
    // read, so it must not bump the React snapshot.
    if (structural || input.gone.length > 0) {
      this.publish();
    } else {
      this.snapshot = { ...this.snapshot, connection: this.connection };
      this.notify();
    }
    this.scheduleDriverFlush();
  }

  // -------------------------------------------------------------------------
  // Mirror and polling rails
  // -------------------------------------------------------------------------

  applyMirror(input: { ts: number; drivers: FleetMirrorDriver[] }): void {
    // The mirror carries no roster, so it can only update drivers the page already
    // knows about — which the snapshot fetch guarantees before this rail is used.
    for (const row of input.drivers) {
      const existing = this.drivers.get(row.id);
      if (!existing) continue;
      const fixAtMs = row.age == null ? input.ts : input.ts - row.age * 1000;
      const flags = flagsFromNames(row.fl);
      const next: FleetDriver = {
        ...existing,
        status: (row.st as FleetStatus) ?? existing.status,
        flags,
        activeFlags: activeFleetFlags(flags),
        lat: row.lat,
        lng: row.lng,
        speedMps: row.sp ?? 0,
        headingDeg: row.hd ?? existing.headingDeg,
        headingSource: row.hs ?? (row.hd == null ? existing.headingSource : "gps"),
        fixAtMs,
        gpsAgeMs: (row.age ?? 0) * 1000,
      };
      this.drivers.set(row.id, next);
      this.dirtyDrivers.add(row.id);
      // The mirror is a 1Hz stream of the same room, so it can extend a trail; the
      // gate inside `append` is what stops it doubling up with the edge rail's points
      // during the brief window where both are delivering.
      this.trails.append(row.id, row.lat, row.lng, fixAtMs);
      this.interpolator.push(row.id, {
        lat: row.lat,
        lng: row.lng,
        headingDeg: next.headingDeg,
        speedMps: next.speedMps,
        tMs: fixAtMs,
      });
    }
    this.connection = { ...this.connection, lastFrameAt: Date.now(), status: "live" };
    this.publish();
    this.scheduleDriverFlush();
  }

  /**
   * Warm start and last-resort rail. Statuses are derived here with the same
   * functions the Worker uses, so a polled page and a socket page cannot disagree
   * about what a driver is doing.
   */
  applySnapshot(input: {
    generatedAt: string;
    settings: Record<string, number> | null;
    drivers: FleetSnapshotRow[];
    zones?: FleetZone[];
  }): void {
    if (input.zones && input.zones.length > 0) this.zones = input.zones;
    if (input.settings) {
      this.thresholds = fleetThresholdsFromSettings(input.settings);
    }

    const nowMs = Date.parse(input.generatedAt) || Date.now();
    const seen = new Set<string>();

    for (const row of input.drivers) {
      seen.add(row.driver_id);
      const lat = toNumber(row.latitude);
      const lng = toNumber(row.longitude);
      const fixAtMs = Math.max(toTime(row.last_report_at), toTime(row.last_seen_at));
      const shiftStart = toTime(row.shift?.session1_start_at) || null;
      const shiftEnd =
        toTime(row.shift?.session2_end_at) || toTime(row.shift?.session1_end_at) || null;

      const signals = {
        isBlocked: row.is_blocked === true,
        accountStatus: row.account_status,
        isOnDuty: row.is_on_duty === true,
        isOnline: row.is_online === true,
        locationOff: row.is_on_duty === true && lat == null && lng == null,
        lastFixAtMs: fixAtMs || null,
        trackingStatus: normalizeTracking(row.tracking_status),
        speedMps: toNumber(row.speed_mps),
        activeDeliveryId: row.active_delivery_id,
        batteryPct: row.battery_pct,
        isMocked: row.is_mocked === true,
        // Assigned-zone geometry is the Worker's job on the edge rail. The polling
        // rail can still flag Out of Zone from `out_of_zone_since`, which is what
        // the database already records on the pin.
        inAssignedZone: row.out_of_zone_since ? false : null,
        rangeStatus: normalizeRange(row.zone_status),
        shiftScheduledStartMs: shiftStart,
        shiftScheduledEndMs: shiftEnd,
        shiftCheckInAtMs: toTime(row.on_duty_since) || null,
      };

      const status = fleetStatus(signals, nowMs, this.thresholds);
      const flags = fleetFlags(signals, nowMs, this.thresholds);
      const existing = this.drivers.get(row.driver_id);

      const meta: DriverMeta = {
        idIdx: existing?.idIdx ?? 0,
        driverId: row.driver_id,
        driverName: row.driver_name ?? row.driver_code,
        driverCode: row.driver_code,
        employeeId: row.employee_id,
        avatarObjectKey: row.avatar_object_key,
        avatarUpdatedAt: row.avatar_updated_at,
        zoneId: row.zone_id,
        zoneName: row.zone_name,
        partnerId: row.partner_id,
        partnerName: row.partner_name,
        restaurantName: row.restaurant_name,
        vehicleLabel: row.vehicle_reg_number ?? row.vehicle_bike_id,
        vehicleTypeKey: row.vehicle_type_key ?? "bike",
        accountStatus: row.account_status ?? "pending",
        onDutySince: row.on_duty_since,
        deliveriesToday: row.deliveries_today ?? 0,
        deliveriesCompletedToday: row.deliveries_completed_today ?? 0,
        distanceTodayMeters: toNumber(row.distance_today_meters) ?? 0,
        batteryPct: normalizeBatteryPct(row.battery_pct),
        accuracyMeters: toNumber(row.accuracy_meters),
        activeDeliveryId: row.active_delivery_id,
        currentZoneId: existing?.meta.currentZoneId ?? null,
        currentZoneName: existing?.meta.currentZoneName ?? null,
        shiftStartAt: row.shift?.session1_start_at ?? null,
        shiftEndAt: row.shift?.session2_end_at ?? row.shift?.session1_end_at ?? null,
        lastFixAt: row.last_report_at ?? row.last_seen_at,
      };

      /*
       * The poll / 120s roster snapshot is minutes behind a live ingest. Replacing a
       * rider who just moved with the database's last flush is what made Moving flap
       * to Offline and took Online / On Duty back to 0 while the rail still said Moving.
       * Clock-out, block and inactive still win: those are roster facts, not poses.
       */
      const liveIsFresher =
        existing != null &&
        existing.fixAtMs > (fixAtMs || 0) &&
        row.is_on_duty === true &&
        row.is_blocked !== true &&
        (row.account_status == null || row.account_status === "active");

      if (liveIsFresher && existing) {
        const live = hasLiveTelemetry(existing.status);
        let nextStatus = existing.status;
        if (row.active_delivery_id) {
          if (live && nextStatus !== "location_off") nextStatus = "on_delivery";
        } else if (nextStatus === "on_delivery") {
          nextStatus = isMovingSpeed(existing.speedMps, this.thresholds) ? "moving" : "idle";
        }
        const nextFlags = {
          ...existing.flags,
          on_duty: true,
          online: live,
          out_of_range: live && normalizeRange(row.zone_status) === "out_of_zone",
          out_of_zone: row.out_of_zone_since ? live : existing.flags.out_of_zone,
        };
        this.drivers.set(row.driver_id, {
          ...existing,
          meta: {
            ...meta,
            idIdx: existing.idIdx,
            currentZoneId: existing.meta.currentZoneId,
            currentZoneName: existing.meta.currentZoneName,
            lastFixAt: existing.meta.lastFixAt,
          },
          status: nextStatus,
          flags: nextFlags,
          activeFlags: activeFleetFlags(nextFlags),
        });
        this.dirtyDrivers.add(row.driver_id);
        continue;
      }

      this.drivers.set(row.driver_id, {
        driverId: row.driver_id,
        idIdx: meta.idIdx,
        meta,
        status,
        flags,
        activeFlags: activeFleetFlags(flags),
        lat,
        lng,
        speedMps: toNumber(row.speed_mps) ?? 0,
        headingDeg: toNumber(row.heading_deg) ?? existing?.headingDeg ?? 0,
        headingSource:
          toNumber(row.heading_deg) == null
            ? (existing?.headingSource ?? "none")
            : "gps",
        fixAtMs: fixAtMs || 0,
        gpsAgeMs: fixAtMs ? Math.max(0, nowMs - fixAtMs) : 0,
      });
      this.dirtyDrivers.add(row.driver_id);

      if (lat != null && lng != null) {
        const sample = {
          lat,
          lng,
          headingDeg: toNumber(row.heading_deg) ?? 0,
          speedMps: toNumber(row.speed_mps) ?? 0,
          tMs: fixAtMs || nowMs,
        };
        // Snapshots are minutes apart; interpolating between two of them would slide
        // markers along straight lines they never drove.
        this.interpolator.reset(row.driver_id, sample);
      }
    }

    for (const driverId of [...this.drivers.keys()]) {
      if (seen.has(driverId)) continue;
      this.drivers.delete(driverId);
      this.interpolator.remove(driverId);
      this.trails.remove(driverId);
      this.dirtyDrivers.add(driverId);
    }

    this.connection = { ...this.connection, lastFrameAt: Date.now() };
    this.publish();
    this.scheduleDriverFlush();
  }

  // -------------------------------------------------------------------------
  // Local clock
  // -------------------------------------------------------------------------

  /**
   * Age statuses and the age-derived flags without waiting for a frame.
   *
   * Called on a plain interval rather than folded into the render loop: the map's frame loop
   * only runs while the canvas is mounted and drivers are visible, and a status that goes
   * stale while the insights panel is open still has to change. Kept a pure-ish method taking
   * `nowMs` so the rule is testable without fake timers.
   */
  tickStatusDecay(nowMs: number = Date.now()): void {
    let structural = false;

    for (const [driverId, driver] of this.drivers) {
      const fixAtMs = driver.fixAtMs || null;
      const decayed = decayedFleetStatus(driver.status, fixAtMs, nowMs, this.thresholds);
      const age = gpsAgeSeconds(fixAtMs, nowMs);
      const staleGps =
        decayed == null &&
        age != null &&
        age > gpsGraceForStatus(driver.status, this.thresholds).stale &&
        hasLiveTelemetry(driver.status);

      const statusChanged = decayed != null && decayed !== driver.status;
      const flagChanged = staleGps !== driver.flags.stale_gps;
      if (!statusChanged && !flagChanged) continue;

      const flags = { ...driver.flags, stale_gps: staleGps };
      if (statusChanged && decayed === "gps_offline") {
        flags.online = false;
        flags.out_of_zone = false;
        flags.out_of_range = false;
        flags.overspeed = false;
        flags.stale_gps = false;
      }
      const next: FleetDriver = {
        ...driver,
        status: statusChanged ? decayed! : driver.status,
        flags,
        activeFlags: activeFleetFlags(flags),
        gpsAgeMs: age == null ? driver.gpsAgeMs : Math.round(age * 1000),
      };
      this.drivers.set(driverId, next);
      this.dirtyDrivers.add(driverId);
      if (statusChanged) structural = true;
    }

    if (structural) this.publish();
    this.scheduleDriverFlush();
  }

  // -------------------------------------------------------------------------
  // Feed
  // -------------------------------------------------------------------------

  applyFleetEvents(events: FleetEventFrame[]): void {
    this.pushFeed(
      events.map((event) => ({
        id: `fleet:${event.driverId}:${event.eventKey}:${event.detectedAt}`,
        kind: "fleet" as const,
        driverId: event.driverId,
        driverName: this.drivers.get(event.driverId)?.meta.driverName ?? null,
        eventKey: event.eventKey,
        severity: event.severity,
        value: event.value,
        statusAfter: event.statusAfter,
        success: true,
        errorCode: null,
        latitude: event.latitude,
        longitude: event.longitude,
        context: event.context,
        atMs: Date.parse(event.detectedAt) || Date.now(),
      })),
    );
  }

  applyOpsEvents(events: OpsEventFrame[]): void {
    this.pushFeed(
      events.map((event) => ({
        id: `ops:${event.id}`,
        kind: "ops" as const,
        driverId: event.driverId,
        driverName: this.drivers.get(event.driverId)?.meta.driverName ?? null,
        eventKey: event.operationKey,
        severity: opsSeverity(event),
        value: null,
        statusAfter: null,
        success: event.success,
        errorCode: event.errorCode,
        latitude: null,
        longitude: null,
        context: event.context,
        atMs: Date.parse(event.occurredAt) || Date.now(),
      })),
    );
  }

  /** Poll seed is a warm-start. Re-running it on every roster refresh is what made rows flicker. */
  feedNeedsSeed(): boolean {
    return this.feed.length === 0 && this.heldFeed.length === 0;
  }

  private pushFeed(items: FleetFeedItem[]): void {
    if (items.length === 0) return;
    const ordered = items
      .filter((item) => {
        if (this.feedIds.has(item.id)) return false;
        this.feedIds.add(item.id);
        return true;
      })
      .sort((a, b) => b.atMs - a.atMs);
    if (ordered.length === 0) return;
    if (this.feedPaused) {
      // Held rather than dropped: an operator who paused to read a row still wants
      // the backlog when they resume, and the "N new" pill needs a real count.
      this.heldFeed = [...ordered, ...this.heldFeed].slice(0, FEED_LIMIT);
    } else {
      this.feed = [...ordered, ...this.feed].slice(0, FEED_LIMIT);
    }
    this.publish();
  }

  // -------------------------------------------------------------------------
  // Snapshot assembly
  // -------------------------------------------------------------------------

  private matchesFilters(driver: FleetDriver): boolean {
    const { search, statuses, zoneId, partnerId, alertsOnly } = this.filters;

    if (alertsOnly) {
      if (!isFleetAlert(driver.status, driver.flags)) return false;
    } else if (statuses && statuses.length > 0 && !statuses.includes(driver.status)) {
      return false;
    } else if (statuses && statuses.length === 0) {
      return false;
    }
    if (zoneId && driver.meta.zoneId !== zoneId && driver.meta.currentZoneId !== zoneId) {
      return false;
    }
    if (partnerId && driver.meta.partnerId !== partnerId) return false;

    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      const haystack = [
        driver.meta.driverName,
        driver.meta.driverCode,
        driver.meta.employeeId,
        driver.meta.zoneName,
        driver.meta.currentZoneName,
        driver.meta.partnerName,
        driver.meta.restaurantName,
        driver.meta.vehicleLabel,
        driver.status,
        driver.flags.out_of_zone ? "out of zone" : "",
        driver.flags.out_of_range ? "out of range" : "",
        ...driver.activeFlags,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }

    return true;
  }

  private buildSnapshot(): FleetSnapshot {
    const counts = Object.fromEntries(
      FLEET_DISTRIBUTION_BUCKETS.map((bucket) => [bucket, 0]),
    ) as Record<FleetDistributionBucket, number>;

    const zoneCounts = new Map<string, FleetZoneCount>();
    const partners = new Map<string, string>();
    const visible: FleetDriver[] = [];

    const kpis: FleetKpis = {
      onDuty: 0,
      online: 0,
      moving: 0,
      onDelivery: 0,
      idle: 0,
      offline: 0,
      alerts: 0,
      outOfZone: 0,
      overspeed: 0,
      lowBattery: 0,
      gpsOffline: 0,
      deliveriesToday: 0,
      deliveriesCompletedToday: 0,
      distanceTodayKm: 0,
      avgSpeedKmh: 0,
    };

    let speedSum = 0;
    let speedCount = 0;

    for (const driver of this.drivers.values()) {
      if (driver.meta.partnerId && driver.meta.partnerName) {
        partners.set(driver.meta.partnerId, driver.meta.partnerName);
      }
      /*
       * The selected driver is pinned into the roster even when the filters exclude them.
       *
       * Selecting an Offline rider and then having their card disappear — because Offline
       * is not a checked status chip, or because the search box still holds a term — takes
       * away the one surface that explains *why* they are offline. The same reasoning as
       * the wire's pinned driver, which the room keeps sending across a pan.
       *
       * Pinned but not counted: they are listed and drawn, and the KPI tiles keep
       * describing the filter the operator set. A count that included them would disagree
       * with the chips directly above it.
       */
      const matches = this.matchesFilters(driver);
      if (!matches && driver.driverId !== this.selectedDriverId) continue;
      visible.push(driver);
      if (!matches) continue;

      counts[fleetDistributionBucket(driver.status, driver.flags)] += 1;

      if (driver.flags.on_duty && driver.status !== "offline") kpis.onDuty += 1;
      if (hasLiveTelemetry(driver.status)) kpis.online += 1;
      if (driver.status === "moving") kpis.moving += 1;
      if (driver.status === "on_delivery") kpis.onDelivery += 1;
      if (driver.status === "idle") kpis.idle += 1;
      if (driver.status === "offline") kpis.offline += 1;
      if (driver.status === "gps_offline" || driver.status === "location_off") {
        kpis.gpsOffline += 1;
      }
      if (isFleetAlert(driver.status, driver.flags)) kpis.alerts += 1;
      if (driver.flags.out_of_zone || driver.flags.out_of_range) kpis.outOfZone += 1;
      if (driver.flags.overspeed) kpis.overspeed += 1;
      if (driver.flags.low_battery) kpis.lowBattery += 1;

      kpis.deliveriesToday += driver.meta.deliveriesToday;
      kpis.deliveriesCompletedToday += driver.meta.deliveriesCompletedToday;
      kpis.distanceTodayKm += driver.meta.distanceTodayMeters / 1000;

      // Average over moving drivers only: including parked riders would report a
      // fleet doing 4 km/h and mean nothing.
      if (driver.status === "moving" || driver.status === "on_delivery") {
        speedSum += driver.speedMps;
        speedCount += 1;
      }

      const zoneKey = driver.meta.currentZoneId ?? driver.meta.zoneId ?? "none";
      const existingZone = zoneCounts.get(zoneKey);
      if (existingZone) {
        existingZone.count += 1;
      } else {
        const zone = this.zones.find((z) => z.id === zoneKey);
        zoneCounts.set(zoneKey, {
          zoneId: zoneKey === "none" ? null : zoneKey,
          zoneName:
            zone?.name ??
            driver.meta.currentZoneName ??
            driver.meta.zoneName ??
            "Unassigned",
          color: zone?.color ?? null,
          count: 1,
        });
      }
    }

    kpis.distanceTodayKm = Math.round(kpis.distanceTodayKm * 10) / 10;
    kpis.avgSpeedKmh =
      speedCount === 0 ? 0 : Math.round((speedSum / speedCount) * 3.6 * 10) / 10;

    visible.sort((a, b) => {
      const weight = fleetStatusSortWeight(a.status) - fleetStatusSortWeight(b.status);
      if (weight !== 0) return weight;
      return a.meta.driverName.localeCompare(b.meta.driverName);
    });

    return {
      connection: this.connection,
      driverIds: visible.map((driver) => driver.driverId),
      totalDrivers: this.drivers.size,
      counts,
      zoneCounts: [...zoneCounts.values()].sort((a, b) => b.count - a.count),
      kpis,
      zones: this.zones,
      partners: [...partners.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      feed: composeFleetFeed(this.feed, this.drivers.values()),
      pendingFeedCount: this.heldFeed.length,
      feedPaused: this.feedPaused,
      selectedDriverId: this.selectedDriverId,
      filters: this.filters,
      version: this.version,
    };
  }

  private publish(): void {
    this.version += 1;
    this.snapshot = this.buildSnapshot();
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private scheduleDriverFlush(): void {
    if (this.dirtyDrivers.size === 0) return;
    if (this.driverFlushHandle) return;

    const elapsed = Date.now() - this.lastDriverFlushAt;
    const delay = Math.max(0, DRIVER_NOTIFY_MS - elapsed);
    this.driverFlushHandle = setTimeout(() => {
      this.driverFlushHandle = null;
      this.lastDriverFlushAt = Date.now();
      const dirty = [...this.dirtyDrivers];
      this.dirtyDrivers.clear();
      for (const driverId of dirty) {
        const set = this.driverListeners.get(driverId);
        if (!set) continue;
        for (const listener of set) listener();
      }
    }, delay);
  }

  dispose(): void {
    if (this.driverFlushHandle) clearTimeout(this.driverFlushHandle);
    this.driverFlushHandle = null;
    this.listeners.clear();
    this.driverListeners.clear();
    this.dirtyDrivers.clear();
    this.drivers.clear();
    this.byIdIdx.clear();
    this.feedIds.clear();
    this.interpolator.clear();
    this.trails.clear();
  }
}

function opsSeverity(event: OpsEventFrame): FleetEventSeverity {
  if (!event.success) return "warning";
  // Reuse the Class B table where the key overlaps; anything else is informational
  // by definition — a successful driver action is something they did, not a problem.
  return fleetEventSeverity(event.operationKey as never);
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toTime(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeTracking(value: string | null | undefined): FleetTrackingStatus {
  return value === "moving" || value === "delivery_submit" ? value : "idle";
}

function normalizeRange(
  value: string | null | undefined,
): "in_zone" | "out_of_zone" | "unknown" | null {
  if (value === "in_zone" || value === "out_of_zone" || value === "unknown") return value;
  return null;
}
