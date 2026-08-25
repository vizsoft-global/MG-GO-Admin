/**
 * FleetRoom — the authoritative in-memory fleet.
 *
 * One Durable Object holds every on-duty driver's current position, status and rule
 * state, accepts ingest from the driver app, and fans a fixed-rate delta frame out to
 * every admin socket. Postgres is written every 10s as durability, not as the path a
 * pin travels down; that inversion is the whole point of the redesign.
 *
 * Deliberately not persisted to DO storage: positions. A position is worthless five
 * seconds after it was taken, and at 500 drivers × 4Hz a persisted position would be
 * ~170k storage writes per hour to protect data that regenerates in one cadence. If
 * the room is evicted, the roster reloads from `admin_live_fleet_snapshot` and pins
 * repopulate on the next report.
 */

import type { Env } from "./env";
import {
  debouncedMembership,
  parseZone,
  resolveZoneAt,
  type WorkerZone,
} from "./geo";
import {
  matchesLiveViewport,
  matchesRosterFilters,
  type InterestSubject,
} from "./fleet-interest";
import {
  evaluateRules,
  initialRuleState,
  type FleetEventDraft,
  type RuleState,
} from "./fleet-rules";
import { hashToken, verifyAdminToken } from "./auth";
import {
  broadcast,
  callRpc,
  resolveUserFromToken,
  selectRows,
  type SupabaseConfig,
} from "./supabase";
import {
  emptyView,
  encodePosition,
  encodeTrailPoint,
  flagBits,
  trailDistanceMeters,
  TRAIL_MIN_GAP_MS,
  TRAIL_MIN_MOVE_M,
  TRAIL_WINDOW_MS,
  WIRE_VERSION,
  type ClientFrame,
  type DriverMeta,
  type FleetEventFrame,
  type HeadingSource,
  type OpsEventFrame,
  type PositionTuple,
  type ServerFrame,
  type SocketView,
  type TrailTrack,
} from "../../../../src/features/live-tracking-v2/fleet-wire";
import {
  fleetFlags,
  fleetStatus,
  fleetThresholdsAsSettings,
  fleetThresholdsFromSettings,
  resolveFleetThresholds,
  type FleetEntitySignals,
  type FleetFlagSet,
  type FleetStatus,
  type FleetThresholds,
  type FleetTrackingStatus,
} from "../../../../src/features/live-tracking-v2/fleet-status";

const ROSTER_TTL_MS = 60_000;
const TOKEN_CACHE_TTL_MS = 10 * 60_000;
/** Points held per driver between durable flushes. 10s at a 1Hz cadence is 10. */
const MAX_PENDING_POINTS = 16;
/** Entities with no report for this long leave the room entirely. */
const EVICT_AFTER_MS = 30 * 60_000;
const OPS_POLL_LIMIT = 200;

/**
 * Durable-write gates. Deliberately ~the old 5s report cadence, so raising the app to
 * 1Hz leaves the `driver_locations` write rate where it was: 1Hz ungated would be
 * ~43M rows/day, and nothing reads that resolution — the day route simplifies it away
 * and the live map takes its points from this room, not from Postgres.
 */
const FLUSH_MIN_GAP_MS = 5_000;

/**
 * Movement required *in addition* to the gap, not as an alternative to it.
 *
 * As an alternative trigger (the first cut of this) the write rate scaled with
 * speed: a rider at 35km/h crossed 25m every 2.6s and wrote ~23 rows/minute where
 * the old 5s cadence wrote 12 — measurable with `fleet-sim --target room`. As a
 * requirement it does the opposite job, dropping a parked phone's duplicates while
 * pinning the ceiling at one row per [FLUSH_MIN_GAP_MS] whatever the speed.
 */
const FLUSH_MIN_MOVE_M = 5;

/**
 * Hard cap per trail. The gates alone bound it to `TRAIL_WINDOW_MS / TRAIL_MIN_GAP_MS`
 * (200), so this only guards against a clock jumping backwards.
 */
const MAX_TRAIL_POINTS = 240;

/**
 * Above this the fix describes a cell tower rather than a rider.
 *
 * Chosen from production data: Android's network provider reports exactly 100, while a
 * real GPS fix in an urban canyon degrades to about 20-40m. Kept in step with the
 * driver app's `coarseGpsAccuracyMeters` and the SQL exclusion in
 * `admin_get_driver_day_route`.
 */
const COARSE_FIX_ACCURACY_M = 50;

/** How long an accurate pin outranks an incoming coarse one. */
const COARSE_FIX_GRACE_MS = 2 * 60_000;

function isCoarseFix(accuracyM: number | null): boolean {
  return accuracyM != null && accuracyM > COARSE_FIX_ACCURACY_M;
}

/** Trails per frame. A first frame carrying 500 tails would block the room's thread. */
const MAX_TRAIL_TRACKS_PER_FRAME = 120;

export type PendingPoint = {
  lat: number;
  lng: number;
  speedMps: number | null;
  accuracyM: number | null;
  headingDeg: number | null;
  headingSource: HeadingSource;
  batteryPct: number | null;
  altitudeM: number | null;
  networkType: string | null;
  chargingState: string | null;
  isMocked: boolean | null;
  locationProvider: string | null;
  activeDeliveryId: string | null;
  deliveryId: string | null;
  trackingStatus: FleetTrackingStatus;
  clientTs: string;
  replay: boolean;
};

type Entity = {
  idIdx: number;
  driverId: string;
  lat: number | null;
  lng: number | null;
  speedMps: number | null;
  headingDeg: number | null;
  headingSource: HeadingSource;
  accuracyM: number | null;
  batteryPct: number | null;
  isMocked: boolean;
  lastFixAtMs: number | null;
  /**
   * Recent history as flat `lat*1e5, lng*1e5, unix seconds` triplets, gated and
   * trimmed to `TRAIL_WINDOW_MS`. Held here rather than queried per client: a socket
   * that pans across the city would otherwise re-read ten minutes of
   * `driver_locations` for every driver it uncovers.
   */
  trail: number[];
  trackingStatus: FleetTrackingStatus;
  activeDeliveryId: string | null;
  rangeStatus: "in_zone" | "out_of_zone" | "unknown" | null;
  status: FleetStatus;
  flags: FleetFlagSet;
  rules: RuleState;
  meta: DriverMeta;
  /** Bumped on any change an admin socket would need to redraw. */
  posVersion: number;
  metaVersion: number;
  pending: PendingPoint[];
  /** Assigned-zone membership after hysteresis. */
  inAssignedZone: boolean | null;
  locationOff: boolean;
  isOnDuty: boolean;
  isOnline: boolean;
  isBlocked: boolean;
  accountStatus: string;
  shiftStartMs: number | null;
  shiftEndMs: number | null;
  shiftCheckInMs: number | null;
  /**
   * Highest `duty_state_version` seen from the app. Bumped by the app on every
   * clock-in and clock-out, which is the only way to tell a real clock-out from
   * a dropped connection: a foreground service that outlives a clock-out keeps
   * publishing the older version and is rejected here rather than keeping a
   * driver who has gone home alive on the map.
   */
  dutyStateVersion: number | null;
};

type SocketRuntime = {
  view: SocketView;
  posSeen: Map<number, number>;
  metaSeen: Map<number, number>;
  /**
   * Drivers whose history this socket already holds. History is sent once on first
   * sight and extended client-side from the delta frames the socket receives anyway.
   */
  trailSeen: Set<number>;
};

export class FleetRoom implements DurableObject {
  private readonly state: DurableObjectState;
  private readonly env: Env;

  private readonly entities = new Map<string, Entity>();
  private readonly idIndex = new Map<number, string>();
  private nextIdIdx = 1;

  private zones: WorkerZone[] = [];
  private thresholds: FleetThresholds = resolveFleetThresholds(null);
  private settings: Record<string, number> = {};

  private readonly sockets = new Map<WebSocket, SocketRuntime>();
  private readonly tokenCache = new Map<string, { driverId: string; expiresAt: number }>();

  private rosterLoadedAt = 0;
  private bootstrapping: Promise<void> | null = null;

  private seq = 0;
  private lastFrameAt = 0;
  private lastMirrorAt = 0;
  private lastFlushAt = 0;
  private flushSoon = false;
  private alarmSetFor = 0;

  private pendingFleetEvents: Array<FleetEventDraft & { driverId: string }> = [];
  private opsCursor: number | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;

    // Sockets survive eviction; their per-socket runtime does not. Rehydrating the
    // view here (rather than lazily) keeps `webSocketMessage` free of setup.
    for (const ws of state.getWebSockets()) {
      this.sockets.set(ws, {
        view: {
          ...emptyView(),
          ...((ws.deserializeAttachment() as SocketView | null) ?? {}),
        },
        posSeen: new Map(),
        metaSeen: new Map(),
        trailSeen: new Set(),
      });
    }
  }

  private get supabase(): SupabaseConfig {
    return {
      url: this.env.SUPABASE_URL,
      serviceRoleKey: this.env.SUPABASE_SERVICE_ROLE_KEY,
      anonKey: this.env.SUPABASE_ANON_KEY,
    };
  }

  private get frameIntervalMs(): number {
    const hz = Number(this.env.POSITION_FRAME_HZ) || 4;
    return Math.max(50, Math.round(1000 / hz));
  }

  private get tickMs(): number {
    return Math.max(500, Number(this.env.TICK_MS) || 2000);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/ws") return await this.acceptAdminSocket(request, url);
      if (url.pathname === "/ingest") return await this.ingest(request);
      if (url.pathname === "/refresh") {
        await this.loadRoster(true);
        return json({ ok: true, drivers: this.entities.size });
      }
      if (url.pathname === "/stats") {
        return json({
          ok: true,
          drivers: this.entities.size,
          sockets: this.sockets.size,
          seq: this.seq,
          rosterLoadedAt: this.rosterLoadedAt,
          zones: this.zones.length,
        });
      }
    } catch (error) {
      return json({ ok: false, error: String(error) }, 500);
    }

    return json({ ok: false, error: "not_found" }, 404);
  }

  // -------------------------------------------------------------------------
  // Bootstrap
  // -------------------------------------------------------------------------

  private async ensureBootstrapped(force = false): Promise<void> {
    const fresh = Date.now() - this.rosterLoadedAt < ROSTER_TTL_MS;
    if (!force && fresh && this.entities.size >= 0 && this.zones.length >= 0 && this.rosterLoadedAt > 0) {
      return;
    }
    // Concurrent ingests during a cold start must not each run a snapshot.
    if (!this.bootstrapping) {
      this.bootstrapping = this.loadRoster(force).finally(() => {
        this.bootstrapping = null;
      });
    }
    await this.bootstrapping;
  }

  private async loadRoster(force: boolean): Promise<void> {
    if (!force && Date.now() - this.rosterLoadedAt < ROSTER_TTL_MS) return;

    const [snapshot, zoneRows] = await Promise.all([
      callRpc<{
        generated_at: string;
        settings: Record<string, number> | null;
        drivers: SnapshotDriver[];
      }>(this.supabase, "admin_live_fleet_snapshot", { p_seen_within_minutes: 30 }),
      selectRows<{
        id: string;
        name: string | null;
        color: string | null;
        zone_type: string | null;
        geometry: unknown;
      }>(this.supabase, "zones?select=id,name,color,zone_type,geometry"),
    ]);

    this.zones = zoneRows
      .map((row) => parseZone(row))
      .filter((zone): zone is WorkerZone => zone !== null);

    this.settings = snapshot.settings ?? {};
    this.thresholds = fleetThresholdsFromSettings(this.settings);

    const seen = new Set<string>();
    for (const row of snapshot.drivers ?? []) {
      seen.add(row.driver_id);
      this.upsertFromSnapshot(row);
    }

    // A driver who left the snapshot window and has no live pin is gone from the
    // room; one who is still reporting stays, because the snapshot is a warm start,
    // not a source of truth about the present.
    const nowMs = Date.now();
    for (const [driverId, entity] of this.entities) {
      if (seen.has(driverId)) continue;
      const age = entity.lastFixAtMs == null ? Infinity : nowMs - entity.lastFixAtMs;
      if (age > EVICT_AFTER_MS) this.removeEntity(driverId);
    }

    this.rosterLoadedAt = nowMs;
  }

  private allocIdIdx(driverId: string): number {
    const idIdx = this.nextIdIdx;
    this.nextIdIdx += 1;
    this.idIndex.set(idIdx, driverId);
    return idIdx;
  }

  private removeEntity(driverId: string): void {
    const entity = this.entities.get(driverId);
    if (!entity) return;
    this.entities.delete(driverId);
    this.idIndex.delete(entity.idIdx);
  }

  private upsertFromSnapshot(row: SnapshotDriver): Entity {
    const existing = this.entities.get(row.driver_id);
    const idIdx = existing?.idIdx ?? this.allocIdIdx(row.driver_id);

    const shift = row.shift ?? null;
    const shiftStartMs = toMs(shift?.session1_start_at);
    const shiftEndMs = toMs(shift?.session2_end_at ?? shift?.session1_end_at);

    const meta: DriverMeta = {
      idIdx,
      driverId: row.driver_id,
      driverName: row.driver_name ?? row.driver_code,
      driverCode: row.driver_code,
      employeeId: row.employee_id ?? null,
      avatarObjectKey: row.avatar_object_key ?? null,
      avatarUpdatedAt: row.avatar_updated_at ?? null,
      zoneId: row.zone_id ?? null,
      zoneName: row.zone_name ?? null,
      partnerId: row.partner_id ?? null,
      partnerName: row.partner_name ?? null,
      restaurantName: row.restaurant_name ?? null,
      vehicleLabel: row.vehicle_reg_number ?? row.vehicle_bike_id ?? null,
      vehicleTypeKey: row.vehicle_type_key ?? "bike",
      accountStatus: row.account_status ?? "pending",
      onDutySince: row.on_duty_since ?? null,
      deliveriesToday: numberOr(row.deliveries_today, 0),
      deliveriesCompletedToday: numberOr(row.deliveries_completed_today, 0),
      distanceTodayMeters: numberOr(row.distance_today_meters, 0),
      batteryPct: numberOrNull(row.battery_pct),
      accuracyMeters: numberOrNull(row.accuracy_meters),
      activeDeliveryId: row.active_delivery_id ?? null,
      currentZoneId: null,
      currentZoneName: null,
      shiftStartAt: shift?.session1_start_at ?? null,
      shiftEndAt: shift?.session2_end_at ?? shift?.session1_end_at ?? null,
      lastFixAt: row.last_report_at ?? row.last_seen_at ?? null,
    };

    // Freshest of the two: `last_report_at` survives coalescing, `last_seen_at` is
    // bumped by every write. v1 read only the latter and showed coalesced
    // heartbeats as GPS-offline.
    const snapshotFixMs = Math.max(
      toMs(row.last_report_at) ?? 0,
      toMs(row.last_seen_at) ?? 0,
    );

    const entity: Entity = existing ?? {
      idIdx,
      driverId: row.driver_id,
      lat: numberOrNull(row.latitude),
      lng: numberOrNull(row.longitude),
      speedMps: numberOrNull(row.speed_mps),
      headingDeg: numberOrNull(row.heading_deg),
      // Postgres does not record where a bearing came from, and every build that
      // wrote `heading_deg` before fusion wrote a GPS course — so a persisted bearing
      // is reported as `gps` rather than inventing a third "unknown but present".
      headingSource: numberOrNull(row.heading_deg) == null ? "none" : "gps",
      accuracyM: numberOrNull(row.accuracy_meters),
      batteryPct: numberOrNull(row.battery_pct),
      isMocked: row.is_mocked === true,
      lastFixAtMs: snapshotFixMs > 0 ? snapshotFixMs : null,
      trail: [],
      trackingStatus: normalizeTracking(row.tracking_status),
      activeDeliveryId: row.active_delivery_id ?? null,
      rangeStatus: normalizeRange(row.zone_status),
      status: "offline",
      flags: fleetFlags({ isOnDuty: false, lastFixAtMs: null, trackingStatus: "idle" }, Date.now()),
      rules: initialRuleState(),
      meta,
      posVersion: 1,
      metaVersion: 1,
      pending: [],
      inAssignedZone: null,
      locationOff: false,
      isOnDuty: row.is_on_duty === true,
      isOnline: row.is_online === true,
      isBlocked: row.is_blocked === true,
      accountStatus: row.account_status ?? "pending",
      shiftStartMs,
      shiftEndMs,
      shiftCheckInMs: toMs(row.on_duty_since),
      dutyStateVersion: null,
    };

    if (existing) {
      // The snapshot is authoritative for roster facts and stale for position: an
      // ingest that landed one second ago must not be rolled back to a database read.
      entity.meta = { ...meta, currentZoneId: existing.meta.currentZoneId, currentZoneName: existing.meta.currentZoneName };
      entity.metaVersion += 1;
      entity.isOnDuty = row.is_on_duty === true;
      entity.isOnline = row.is_online === true;
      entity.isBlocked = row.is_blocked === true;
      entity.accountStatus = row.account_status ?? entity.accountStatus;
      entity.shiftStartMs = shiftStartMs;

      /*
       * A new duty session retires the version comparison.
       *
       * `dutyStateVersion` exists to tell a zombie foreground service apart from a live
       * one *within one session*, and it only ever moves up. Across a clock-out and
       * clock-in it became a trap: the restarted service reads the counter from a
       * `SharedPreferences` cache that belongs to another isolate, so it can publish a
       * value below the one the room already holds and be refused with 409 for the rest
       * of the shift — a driver online and moving, drawn Offline. A different check-in
       * time is proof of a different session, so the comparison starts over.
       */
      const nextCheckInMs = toMs(row.on_duty_since);
      if (nextCheckInMs !== entity.shiftCheckInMs) entity.dutyStateVersion = null;
      entity.shiftEndMs = shiftEndMs;
      entity.shiftCheckInMs = nextCheckInMs;

      // Roster facts, not position facts: they must apply even when the room's pin
      // is fresher than the database's. Delivery id comes from `deliveries.status`;
      // range comes from the last durable `zone_status` write. Skipping them while
      // GPS is live is why Entered zone landed in the feed and Out of Range stuck
      // on the list until a client refresh happened to catch a newer snapshot.
      entity.activeDeliveryId = row.active_delivery_id ?? null;
      entity.rangeStatus = normalizeRange(row.zone_status);

      if ((entity.lastFixAtMs ?? 0) < snapshotFixMs) {
        entity.lat = numberOrNull(row.latitude) ?? entity.lat;
        entity.lng = numberOrNull(row.longitude) ?? entity.lng;
        entity.speedMps = numberOrNull(row.speed_mps);
        entity.headingDeg = numberOrNull(row.heading_deg);
        entity.headingSource = numberOrNull(row.heading_deg) == null ? "none" : "gps";
        entity.batteryPct = numberOrNull(row.battery_pct);
        entity.accuracyM = numberOrNull(row.accuracy_meters);
        entity.trackingStatus = normalizeTracking(row.tracking_status);
        entity.lastFixAtMs = snapshotFixMs;
        entity.posVersion += 1;
      }
    } else {
      this.entities.set(row.driver_id, entity);
    }

    // `driver_clear_live_location` removes the row entirely, so an on-duty driver
    // with no coordinates is location-off rather than merely silent.
    entity.locationOff = entity.isOnDuty && entity.lat == null && entity.lng == null;

    const previousStatus = entity.status;
    this.refreshDerived(entity, Date.now(), false);
    // Status rides on the position frame, and a roster read can change it without any
    // new position at all — an opened delivery, a clock-in, a block.
    if (existing && entity.status !== previousStatus) entity.posVersion += 1;
    return entity;
  }

  // -------------------------------------------------------------------------
  // Ingest
  // -------------------------------------------------------------------------

  private async resolveDriverId(request: Request): Promise<string | null> {
    const header = request.headers.get("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) return null;

    const key = await hashToken(token);
    const cached = this.tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.driverId;

    const user = await resolveUserFromToken(this.supabase, token);
    if (!user) {
      this.tokenCache.delete(key);
      return null;
    }

    // `drivers.id` is the profile id, which is the auth uid — no extra lookup.
    this.tokenCache.set(key, {
      driverId: user.id,
      expiresAt: Date.now() + TOKEN_CACHE_TTL_MS,
    });
    if (this.tokenCache.size > 2000) {
      for (const [k, v] of this.tokenCache) {
        if (v.expiresAt <= Date.now()) this.tokenCache.delete(k);
      }
    }
    return user.id;
  }

  private async ingest(request: Request): Promise<Response> {
    const driverId = await this.resolveDriverId(request);
    if (!driverId) return json({ ok: false, error: "unauthorized" }, 401);

    const body = (await request.json().catch(() => null)) as IngestBody | null;
    const points = Array.isArray(body?.points) ? body!.points : [];
    if (points.length === 0) return json({ ok: false, error: "points_required" }, 400);
    if (points.length > 200) return json({ ok: false, error: "batch_too_large" }, 413);

    await this.ensureBootstrapped();

    // A driver who clocked in after the last snapshot. One targeted read rather than
    // a whole-fleet refresh, which at 500 drivers would be a self-inflicted
    // thundering herd every time a shift starts.
    const entity =
      this.entities.get(driverId) ?? (await this.loadSingleDriver(driverId));
    if (!entity) return json({ ok: false, error: "unknown_driver" }, 404);

    // A foreground service can outlive the clock-out that was supposed to stop
    // it. Its publishes carry the version from before that clock-out, so they are
    // refused outright — otherwise a driver who went home stays on the map,
    // moving, until the process is finally killed.
    const version = numberOrNull(body?.duty_state_version as number);
    if (version != null) {
      if (entity.dutyStateVersion != null && version < entity.dutyStateVersion) {
        return json({ ok: false, error: "stale_duty_state" }, 409);
      }
      entity.dutyStateVersion = version;
    }

    const nowMs = Date.now();
    let applied = 0;
    let heartbeated = false;

    for (const raw of points) {
      const point = normalizePoint(raw);
      if (!point) continue;

      entity.pending.push(point);
      if (entity.pending.length > MAX_PENDING_POINTS) {
        // Drop from the middle, never the ends: the first point anchors distance
        // from the previous flush and the last is the live pin.
        entity.pending.splice(1, 1);
      }

      if (point.replay) continue;

      const clientMs = toMs(point.clientTs) ?? nowMs;
      // An out-of-order point must not teleport the pin backwards.
      if (entity.lastFixAtMs != null && clientMs < entity.lastFixAtMs) continue;

      /*
       * A coarse fix does not get to move the pin while an accurate one is still warm.
       *
       * Android's network provider reports `accuracy_meters` of exactly 100 from a cell
       * tower that can be 600m from the rider, and a phone alternating providers then
       * ping-pongs across the map every couple of seconds — which is what produced the
       * "multiple pointers for an idle driver" reading, since the trail drew the hop too.
       * The driver app applies the same rule before reporting; this is the half that
       * protects the map from builds that predate it.
       *
       * It is a *deferral*, not a drop: the point still goes to `pending`, so the durable
       * history keeps what the device actually said, and a driver whose GPS never
       * recovers still gets their pin once the warm window lapses.
       *
       * lastFixAtMs still advances. Leaving it frozen is what aged an otherwise-live
       * rider to GPS Offline every 90s, then back to Moving on the next accurate fix.
       */
      if (
        isCoarseFix(point.accuracyM) &&
        entity.lat != null &&
        !isCoarseFix(entity.accuracyM) &&
        entity.lastFixAtMs != null &&
        nowMs - entity.lastFixAtMs < COARSE_FIX_GRACE_MS
      ) {
        entity.lastFixAtMs = Math.min(clientMs, nowMs);
        entity.locationOff = false;
        entity.isOnDuty = true;
        entity.isOnline = true;
        heartbeated = true;
        continue;
      }

      this.appendTrail(entity, point.lat, point.lng, clientMs);

      entity.lat = point.lat;
      entity.lng = point.lng;
      entity.speedMps = point.speedMps;
      entity.headingDeg = point.headingDeg;
      entity.headingSource = point.headingSource;
      entity.accuracyM = point.accuracyM;
      entity.batteryPct = point.batteryPct ?? entity.batteryPct;
      entity.isMocked = point.isMocked === true;
      entity.trackingStatus = point.trackingStatus;
      // Deliberately one-way: a payload may *announce* a delivery the roster has not
      // read yet, but it may not clear one. The phone's foreground service reads the
      // delivery id from a `SharedPreferences` cache belonging to another isolate and
      // usually sends null, so honouring null here is what kept On Delivery off the map.
      // The clear comes from the roster, where `deliveries.status` is authoritative.
      if (point.activeDeliveryId != null) {
        entity.activeDeliveryId = point.activeDeliveryId;
      }
      entity.lastFixAtMs = Math.min(clientMs, nowMs);
      entity.locationOff = false;
      entity.isOnDuty = true;
      entity.isOnline = true;
      applied += 1;
    }

    if (applied > 0 || heartbeated) {
      entity.posVersion += 1;
      this.refreshDerived(entity, nowMs, true);
    }

    // Everything periodic is ingest-driven; see Env.TICK_MS.
    await this.pump(nowMs);
    await this.scheduleAlarm();

    return json({
      ok: true,
      accepted: applied,
      queued: entity.pending.length,
      serverTime: nowMs,
      frameHz: Number(this.env.POSITION_FRAME_HZ) || 4,
    });
  }

  private async loadSingleDriver(driverId: string): Promise<Entity | null> {
    const snapshot = await callRpc<{
      drivers: SnapshotDriver[];
      settings: Record<string, number> | null;
    }>(this.supabase, "admin_live_fleet_snapshot", { p_seen_within_minutes: 1440 });

    const row = (snapshot.drivers ?? []).find((d) => d.driver_id === driverId);
    if (!row) return null;
    return this.upsertFromSnapshot(row);
  }

  // -------------------------------------------------------------------------
  // Trails
  // -------------------------------------------------------------------------

  /**
   * Appends a point to a driver's trail, gated and trimmed.
   *
   * The gates are what make ten minutes of history affordable: 1Hz raw is 600 points
   * per rider (~7MB across 500 riders, all of it invisible at any zoom, since 5m of
   * movement is a sub-pixel step until you are practically at street level).
   *
   * Called only for live points — a replayed fix is older than what is already in the
   * buffer, and appending it would draw the trail backwards through the city.
   */
  private appendTrail(entity: Entity, lat: number, lng: number, tsMs: number): void {
    const trail = entity.trail;
    const n = trail.length;

    if (n >= 3) {
      const lastLat = trail[n - 3]! / 1e5;
      const lastLng = trail[n - 2]! / 1e5;
      const lastMs = trail[n - 1]! * 1000;
      if (tsMs <= lastMs) return;
      const moved = trailDistanceMeters(lastLat, lastLng, lat, lng);
      if (moved < TRAIL_MIN_MOVE_M && tsMs - lastMs < TRAIL_MIN_GAP_MS) return;
    }

    const [latE5, lngE5, tsSec] = encodeTrailPoint(lat, lng, tsMs);
    trail.push(latE5, lngE5, tsSec);

    const cutoffSec = Math.round((tsMs - TRAIL_WINDOW_MS) / 1000);
    let drop = 0;
    while (drop + 2 < trail.length && trail[drop + 2]! < cutoffSec) drop += 3;
    if (drop > 0) trail.splice(0, drop);

    const overflow = trail.length / 3 - MAX_TRAIL_POINTS;
    if (overflow > 0) trail.splice(0, Math.ceil(overflow) * 3);
  }

  // -------------------------------------------------------------------------
  // Derivation
  // -------------------------------------------------------------------------

  private signalsFor(entity: Entity): FleetEntitySignals {
    return {
      isBlocked: entity.isBlocked,
      accountStatus: entity.accountStatus,
      isOnDuty: entity.isOnDuty,
      isOnline: entity.isOnline,
      locationOff: entity.locationOff,
      lastFixAtMs: entity.lastFixAtMs,
      trackingStatus: entity.trackingStatus,
      speedMps: entity.speedMps,
      activeDeliveryId: entity.activeDeliveryId,
      batteryPct: entity.batteryPct,
      isMocked: entity.isMocked,
      inAssignedZone: entity.inAssignedZone,
      rangeStatus: entity.rangeStatus,
      shiftScheduledStartMs: entity.shiftStartMs,
      shiftScheduledEndMs: entity.shiftEndMs,
      shiftCheckInAtMs: entity.shiftCheckInMs,
    };
  }

  /** Recomputes zone membership, status, flags and Class B events for one entity. */
  private refreshDerived(entity: Entity, nowMs: number, emitEvents: boolean): void {
    if (entity.lat != null && entity.lng != null) {
      const assigned = entity.meta.zoneId
        ? this.zones.find((zone) => zone.id === entity.meta.zoneId)
        : undefined;
      if (assigned) {
        entity.inAssignedZone = debouncedMembership(
          entity.lat,
          entity.lng,
          assigned,
          entity.inAssignedZone,
          this.thresholds.zoneBufferMeters,
        );
      } else {
        // No assigned zone means no compliance claim to make, not "out of zone".
        entity.inAssignedZone = null;
      }

      const current = resolveZoneAt(entity.lat, entity.lng, this.zones);
      if (current?.id !== entity.meta.currentZoneId) {
        entity.meta = {
          ...entity.meta,
          currentZoneId: current?.id ?? null,
          currentZoneName: current?.name ?? null,
        };
        entity.metaVersion += 1;
      }
    }

    const signals = this.signalsFor(entity);
    const previousStatus = entity.status;
    const previousFlagBits = flagBits(entity.flags);

    if (emitEvents) {
      const outcome = evaluateRules(entity.rules, {
        signals,
        assignedZoneId: entity.meta.zoneId,
        latitude: entity.lat,
        longitude: entity.lng,
        nowMs,
        thresholds: this.thresholds,
      });
      entity.rules = outcome.state;
      entity.status = outcome.status;
      entity.flags = outcome.flags;
      for (const event of outcome.events) {
        this.pendingFleetEvents.push({ ...event, driverId: entity.driverId });
      }
    } else {
      entity.status = fleetStatus(signals, nowMs, this.thresholds);
      entity.flags = fleetFlags(signals, nowMs, this.thresholds);
      entity.rules.status = entity.status;
    }

    if (entity.status !== previousStatus || flagBits(entity.flags) !== previousFlagBits) {
      entity.posVersion += 1;
      // A status transition is the one thing worth breaking the 10s flush cadence
      // for: it is what any other reader of driver_locations will act on.
      if (entity.status !== previousStatus) this.flushSoon = true;
    }
  }

  /** Time-driven pass over every entity: gps offline, idle, shift, eviction. */
  private tickDerived(nowMs: number): void {
    for (const [driverId, entity] of this.entities) {
      const age = entity.lastFixAtMs == null ? Infinity : nowMs - entity.lastFixAtMs;
      if (!entity.isOnDuty && age > EVICT_AFTER_MS) {
        this.removeEntity(driverId);
        continue;
      }
      const previousStatus = entity.status;
      this.refreshDerived(entity, nowMs, true);
      if (entity.status !== previousStatus) entity.posVersion += 1;
    }
  }

  // -------------------------------------------------------------------------
  // Admin sockets
  // -------------------------------------------------------------------------

  private async acceptAdminSocket(request: Request, url: URL): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return json({ ok: false, error: "expected_websocket" }, 426);
    }

    const token = url.searchParams.get("token") ?? "";
    const payload = await verifyAdminToken(this.env.ADMIN_WS_TOKEN_SECRET, token);
    if (!payload) return json({ ok: false, error: "unauthorized" }, 401);

    await this.ensureBootstrapped();

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Hibernation API rather than a held `addEventListener`: an admin tab left open
    // overnight would otherwise bill wall-clock duration for a room doing nothing.
    this.state.acceptWebSocket(server);

    const runtime: SocketRuntime = {
      view: emptyView(),
      posSeen: new Map(),
      metaSeen: new Map(),
      trailSeen: new Set(),
    };
    server.serializeAttachment(runtime.view);
    this.sockets.set(server, runtime);

    this.send(server, {
      t: "hello",
      v: WIRE_VERSION,
      room: this.env.FLEET_ROOM,
      serverTime: Date.now(),
      frameHz: Number(this.env.POSITION_FRAME_HZ) || 4,
      settings: { ...this.settings, ...fleetThresholdsAsSettings(this.thresholds) },
      zones: this.zones.map((zone) => ({
        id: zone.id,
        name: zone.name,
        color: zone.color,
        zoneType: zone.zoneType,
        ring: zone.ring,
        center: zone.center,
        radiusMeters: zone.radiusMeters,
      })),
    });

    // First frame immediately, so the map is populated before the next tick.
    this.pushToSocket(server, runtime, Date.now(), true);
    await this.scheduleAlarm();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    let frame: ClientFrame | null = null;
    try {
      frame = JSON.parse(message) as ClientFrame;
    } catch {
      return;
    }

    const runtime = this.sockets.get(ws) ?? {
      view: { ...emptyView(), ...((ws.deserializeAttachment() as SocketView | null) ?? {}) },
      posSeen: new Map<number, number>(),
      metaSeen: new Map<number, number>(),
      trailSeen: new Set<number>(),
    };
    this.sockets.set(ws, runtime);

    if (frame.t === "ping") {
      this.send(ws, { t: "pong", ts: Date.now() });
      return;
    }

    if (frame.t === "view") {
      runtime.view = {
        bbox: frame.bbox ?? null,
        statuses: frame.statuses ?? null,
        zoneId: frame.zoneId ?? null,
        partnerId: frame.partnerId ?? null,
        driverId: frame.driverId ?? null,
        search: frame.search ?? null,
        knownIds: [],
      };
      ws.serializeAttachment(runtime.view);
      // Filters changed, so what this socket has is no longer what it should have.
      runtime.posSeen.clear();
      runtime.metaSeen.clear();
      // `trailSeen` is deliberately kept: a driver who survives the filter change
      // still has their history on the client, and one who does not is reported in
      // `gone`, which drops the entry so the trail is re-sent if they come back.
      this.pushToSocket(ws, runtime, Date.now(), true);
      await this.scheduleAlarm();
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.sockets.delete(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.sockets.delete(ws);
  }

  private send(ws: WebSocket, frame: ServerFrame): void {
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      this.sockets.delete(ws);
    }
  }

  private interestOf(entity: Entity): InterestSubject {
    const flagHay = entity.flags.out_of_zone ? "out of zone out_of_zone" : "";
    return {
      driverId: entity.driverId,
      status: entity.status,
      lat: entity.lat,
      lng: entity.lng,
      zoneId: entity.meta.zoneId,
      currentZoneId: entity.meta.currentZoneId,
      partnerId: entity.meta.partnerId,
      searchHaystack: [
        entity.meta.driverName,
        entity.meta.driverCode,
        entity.meta.employeeId,
        entity.meta.zoneName,
        entity.meta.currentZoneName,
        entity.meta.partnerName,
        entity.meta.vehicleLabel,
        entity.status,
        flagHay,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    };
  }

  private pushToSocket(
    ws: WebSocket,
    runtime: SocketRuntime,
    nowMs: number,
    force: boolean,
  ): void {
    const tuples: PositionTuple[] = [];
    const meta: DriverMeta[] = [];
    const tracks: TrailTrack[] = [];
    const stillVisible = new Set<number>();

    for (const entity of this.entities.values()) {
      const interest = this.interestOf(entity);
      if (!matchesRosterFilters(interest, runtime.view)) continue;
      stillVisible.add(entity.idIdx);

      if (runtime.metaSeen.get(entity.idIdx) !== entity.metaVersion) {
        meta.push({
          ...entity.meta,
          status: entity.status,
          flagBits: flagBits(entity.flags),
        });
        runtime.metaSeen.set(entity.idIdx, entity.metaVersion);
      }

      const live = matchesLiveViewport(interest, runtime.view);
      const seed = !runtime.posSeen.has(entity.idIdx);
      if (!live && !seed) continue;

      if (
        live &&
        !runtime.trailSeen.has(entity.idIdx) &&
        entity.trail.length >= 6 &&
        tracks.length < MAX_TRAIL_TRACKS_PER_FRAME
      ) {
        // Copied, not referenced: the buffer is mutated in place on every ingest and
        // `JSON.stringify` runs after this function returns.
        tracks.push({ idIdx: entity.idIdx, pts: entity.trail.slice() });
        runtime.trailSeen.add(entity.idIdx);
      }

      if (entity.lat == null || entity.lng == null) continue;
      if (!force && runtime.posSeen.get(entity.idIdx) === entity.posVersion) continue;
      runtime.posSeen.set(entity.idIdx, entity.posVersion);

      tuples.push(
        encodePosition({
          idIdx: entity.idIdx,
          lat: entity.lat,
          lng: entity.lng,
          speedMps: entity.speedMps,
          headingDeg: entity.headingDeg,
          headingSource: entity.headingSource,
          status: entity.status,
          flags: entity.flags,
          ageMs: entity.lastFixAtMs == null ? 0 : Math.max(0, nowMs - entity.lastFixAtMs),
        }),
      );
    }

    const goneIds = new Set<number>();
    for (const idIdx of runtime.posSeen.keys()) {
      if (!stillVisible.has(idIdx)) goneIds.add(idIdx);
    }
    for (const idIdx of runtime.metaSeen.keys()) {
      if (!stillVisible.has(idIdx)) goneIds.add(idIdx);
    }
    for (const idIdx of goneIds) {
      runtime.posSeen.delete(idIdx);
      runtime.metaSeen.delete(idIdx);
      runtime.trailSeen.delete(idIdx);
    }
    const gone = [...goneIds];

    if (meta.length > 0) this.send(ws, { t: "meta", drivers: meta });
    // Trails before the delta: the client hydrates history, then extends it with the
    // point in the same batch, so a tail never renders with a gap at its head.
    if (tracks.length > 0) {
      this.send(ws, { t: "trail", windowMs: TRAIL_WINDOW_MS, tracks });
    }
    if (tuples.length === 0 && gone.length === 0 && !force) return;
    this.send(ws, { t: "delta", seq: this.seq, ts: nowMs, e: tuples, gone });
  }

  private emitFrame(nowMs: number): void {
    this.seq += 1;
    for (const [ws, runtime] of this.sockets) {
      this.pushToSocket(ws, runtime, nowMs, false);
    }
  }

  private fanoutEvents(events: FleetEventFrame[]): void {
    if (events.length === 0) return;
    for (const ws of this.sockets.keys()) this.send(ws, { t: "events", events });
  }

  private fanoutOps(events: OpsEventFrame[]): void {
    if (events.length === 0) return;
    for (const ws of this.sockets.keys()) this.send(ws, { t: "ops", events });
  }

  // -------------------------------------------------------------------------
  // Periodic work
  // -------------------------------------------------------------------------

  /** Runs every cadence that is due. Called from ingest and from the alarm. */
  private async pump(nowMs: number): Promise<void> {
    if (nowMs - this.lastFrameAt >= this.frameIntervalMs) {
      this.lastFrameAt = nowMs;
      this.emitFrame(nowMs);
    }

    const drafts = this.pendingFleetEvents;
    if (drafts.length > 0) {
      this.pendingFleetEvents = [];
      const frames: FleetEventFrame[] = drafts.map((draft) => ({
        driverId: draft.driverId,
        eventKey: draft.eventKey,
        severity: draft.severity,
        value: draft.value,
        statusBefore: draft.statusBefore,
        statusAfter: draft.statusAfter,
        zoneId: draft.zoneId,
        latitude: draft.latitude,
        longitude: draft.longitude,
        context: draft.context,
        detectedAt: draft.detectedAt,
      }));
      // Fan out first, write second: the operator sees the event at edge latency and
      // the row lands whenever Postgres gets to it.
      this.fanoutEvents(frames);
      this.state.waitUntil(this.writeFleetEvents(frames));
    }

    const mirrorMs = Math.max(500, Number(this.env.BROADCAST_MIRROR_MS) || 1000);
    if (this.sockets.size >= 0 && nowMs - this.lastMirrorAt >= mirrorMs) {
      this.lastMirrorAt = nowMs;
      this.state.waitUntil(this.mirror(nowMs));
    }

    const flushMs = Math.max(1000, Number(this.env.POSTGRES_FLUSH_MS) || 10_000);
    if (this.flushSoon || nowMs - this.lastFlushAt >= flushMs) {
      this.lastFlushAt = nowMs;
      this.flushSoon = false;
      this.state.waitUntil(this.flushPositions());
    }

    this.state.waitUntil(this.relayOps());
  }

  private async writeFleetEvents(frames: FleetEventFrame[]): Promise<void> {
    try {
      await callRpc(this.supabase, "admin_record_fleet_events", {
        p_events: frames.map((frame) => ({
          driver_id: frame.driverId,
          event_key: frame.eventKey,
          severity: frame.severity,
          value: frame.value,
          status_before: frame.statusBefore,
          status_after: frame.statusAfter,
          zone_id: frame.zoneId,
          latitude: frame.latitude,
          longitude: frame.longitude,
          context: frame.context,
          detected_at: frame.detectedAt,
          source: "edge",
        })),
      });
    } catch (error) {
      console.error("fleet_events_write_failed", String(error));
    }
  }

  private async flushPositions(): Promise<void> {
    const events: Array<Record<string, unknown>> = [];
    for (const entity of this.entities.values()) {
      if (entity.pending.length === 0) continue;
      for (const point of downsampleForDurability(entity.pending)) {
        events.push({
          driver_id: entity.driverId,
          lat: point.lat,
          lng: point.lng,
          speed_mps: point.speedMps,
          accuracy_m: point.accuracyM,
          heading_deg: point.headingDeg,
          battery_pct: point.batteryPct,
          altitude_m: point.altitudeM,
          network_type: point.networkType,
          charging_state: point.chargingState,
          is_mocked: point.isMocked,
          location_provider: point.locationProvider,
          active_delivery_id: point.activeDeliveryId,
          delivery_id: point.deliveryId,
          tracking_status: point.trackingStatus,
          client_ts: point.clientTs,
          replay: point.replay,
        });
      }
      entity.pending = [];
    }

    if (events.length === 0) return;

    try {
      const result = await callRpc<{
        ok: boolean;
        skipped?: Array<{ driver_id: string; reason: string }>;
      }>(this.supabase, "admin_ingest_driver_positions", { p_events: events });

      // The database is authoritative about duty state. A driver who clocked out
      // between the last snapshot and this flush is rejected there, and that is how
      // the room learns to stop drawing them as live.
      for (const skip of result.skipped ?? []) {
        const entity = this.entities.get(skip.driver_id);
        if (!entity) continue;
        if (skip.reason === "off_duty") {
          entity.isOnDuty = false;
          entity.posVersion += 1;
          this.refreshDerived(entity, Date.now(), true);
        } else if (skip.reason === "unknown_driver") {
          this.removeEntity(skip.driver_id);
        }
      }
    } catch (error) {
      console.error("position_flush_failed", String(error));
    }
  }

  private async mirror(nowMs: number): Promise<void> {
    const drivers: Array<Record<string, unknown>> = [];
    for (const entity of this.entities.values()) {
      if (entity.lat == null || entity.lng == null) continue;
      drivers.push({
        id: entity.driverId,
        name: entity.meta.driverName,
        code: entity.meta.driverCode,
        lat: Math.round(entity.lat * 1e5) / 1e5,
        lng: Math.round(entity.lng * 1e5) / 1e5,
        sp: entity.speedMps == null ? null : Math.round(entity.speedMps * 10) / 10,
        hd: entity.headingDeg,
        hs: entity.headingSource,
        st: entity.status,
        fl: Object.entries(entity.flags)
          .filter(([, on]) => on)
          .map(([flag]) => flag),
        age: entity.lastFixAtMs == null ? null : Math.round((nowMs - entity.lastFixAtMs) / 1000),
      });
    }

    try {
      await broadcast(this.supabase, `fleet:${this.env.FLEET_ROOM}`, "positions", {
        seq: this.seq,
        ts: nowMs,
        drivers,
      });
    } catch (error) {
      console.error("mirror_failed", String(error));
    }
  }

  /**
   * Class A relay. Polled rather than subscribed because a hibernating Durable
   * Object cannot keep a Realtime WebSocket open, and the alternative — never
   * hibernating — costs more than a keyset read every couple of seconds.
   */
  private async relayOps(): Promise<void> {
    if (this.sockets.size === 0) return;
    try {
      if (this.opsCursor == null) {
        const seed = await selectRows<{
          id: number;
          driver_id: string;
          category: string;
          operation_key: string;
          success: boolean;
          error_code: string | null;
          context: Record<string, unknown> | null;
          occurred_at: string;
        }>(
          this.supabase,
          `driver_operation_events?select=id,driver_id,category,operation_key,success,error_code,context,occurred_at&order=id.desc&limit=${OPS_POLL_LIMIT}`,
        );
        this.opsCursor = seed[0]?.id ?? 0;
        if (seed.length > 0) {
          this.fanoutOps(
            [...seed].reverse().map((row) => ({
              id: String(row.id),
              driverId: row.driver_id,
              category: row.category,
              operationKey: row.operation_key,
              success: row.success,
              errorCode: row.error_code,
              context: row.context ?? {},
              occurredAt: row.occurred_at,
            })),
          );
        }
        return;
      }

      const rows = await selectRows<{
        id: number;
        driver_id: string;
        category: string;
        operation_key: string;
        success: boolean;
        error_code: string | null;
        context: Record<string, unknown> | null;
        occurred_at: string;
      }>(
        this.supabase,
        `driver_operation_events?select=id,driver_id,category,operation_key,success,error_code,context,occurred_at&id=gt.${this.opsCursor}&order=id.asc&limit=${OPS_POLL_LIMIT}`,
      );

      if (rows.length === 0) return;
      this.opsCursor = rows[rows.length - 1]!.id;

      this.fanoutOps(
        rows.map((row) => ({
          id: String(row.id),
          driverId: row.driver_id,
          category: row.category,
          operationKey: row.operation_key,
          success: row.success,
          errorCode: row.error_code,
          context: row.context ?? {},
          occurredAt: row.occurred_at,
        })),
      );

      /*
       * Duty transitions authored elsewhere (clock in/out, admin block, auto checkout)
       * are the reason this relay exists at all: without them a clocked-out driver would
       * keep their live pin until the next roster refresh.
       *
       * Delivery operations join them because the open delivery is now a roster fact read
       * from `deliveries.status`. Waiting up to a minute for the next scheduled refresh
       * would mean logging a pickup and watching the rider stay Idle — which is the
       * symptom the phone-supplied id was supposed to avoid and never did.
       */
      if (
        rows.some(
          (row) =>
            row.category === "duty" ||
            row.category === "delivery" ||
            row.operation_key.startsWith("duty.") ||
            row.operation_key.startsWith("delivery."),
        )
      ) {
        this.rosterLoadedAt = 0;
        await this.loadRoster(true);
      }
    } catch (error) {
      console.error("ops_relay_failed", String(error));
    }
  }

  private async scheduleAlarm(): Promise<void> {
    if (this.entities.size === 0 && this.sockets.size === 0) return;
    const due = Date.now() + this.tickMs;
    if (this.alarmSetFor > Date.now() && this.alarmSetFor <= due) return;
    this.alarmSetFor = due;
    await this.state.storage.setAlarm(due);
  }

  async alarm(): Promise<void> {
    this.alarmSetFor = 0;
    const nowMs = Date.now();
    try {
      await this.ensureBootstrapped();
      this.tickDerived(nowMs);
      await this.pump(nowMs);
    } catch (error) {
      console.error("tick_failed", String(error));
    }
    await this.scheduleAlarm();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type IngestBody = { points?: unknown[]; duty_state_version?: number };

type SnapshotDriver = {
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function toMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function numberOrNull(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function numberOr(value: number | string | null | undefined, fallback: number): number {
  return numberOrNull(value) ?? fallback;
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

function normalizePoint(raw: unknown): PendingPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const point = raw as Record<string, unknown>;

  const lat = numberOrNull(point.lat as number);
  const lng = numberOrNull(point.lng as number);
  if (lat == null || lng == null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const clientTs =
    typeof point.client_ts === "string" && Date.parse(point.client_ts)
      ? point.client_ts
      : new Date().toISOString();

  return {
    lat,
    lng,
    speedMps: numberOrNull(point.speed_mps as number),
    accuracyM: numberOrNull(point.accuracy_m as number),
    headingDeg: numberOrNull(point.heading_deg as number),
    headingSource: normalizeHeadingSource(
      stringOrNull(point.heading_source),
      numberOrNull(point.heading_deg as number),
    ),
    batteryPct: numberOrNull(point.battery_pct as number),
    altitudeM: numberOrNull(point.altitude_m as number),
    networkType: stringOrNull(point.network_type),
    chargingState: stringOrNull(point.charging_state),
    isMocked: typeof point.is_mocked === "boolean" ? point.is_mocked : null,
    locationProvider: stringOrNull(point.location_provider),
    activeDeliveryId: stringOrNull(point.active_delivery_id),
    deliveryId: stringOrNull(point.delivery_id),
    trackingStatus: normalizeTracking(stringOrNull(point.tracking_status)),
    clientTs,
    replay: point.replay === true,
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Older app builds send no `heading_source`. Their `heading_deg` was always a GPS
 * course, so that is what they are reported as — the alternative, defaulting to
 * `none`, would make every pre-fusion build's marker stop rotating.
 */
function normalizeHeadingSource(
  raw: string | null,
  headingDeg: number | null,
): HeadingSource {
  if (raw === "gps" || raw === "compass" || raw === "none") return raw;
  return headingDeg == null ? "none" : "gps";
}

/**
 * Thins a flush batch down to what `driver_locations` is actually for.
 *
 * First and last always survive — the first anchors distance from the previous flush
 * and the last is the pin any other reader will see. Between them a point earns its
 * row by being far enough, old enough, or *significant*: a tracking-status change, a
 * delivery stamp, a mocked fix or a replayed one. Dropping those would be the one
 * failure mode that matters here, because the audit trail reads this table to answer
 * where a rider was when they submitted a delivery.
 */
export function downsampleForDurability(points: PendingPoint[]): PendingPoint[] {
  if (points.length <= 2) return points;

  const kept: PendingPoint[] = [points[0]!];
  let anchor = points[0]!;
  let anchorMs = Date.parse(anchor.clientTs);

  for (let i = 1; i < points.length - 1; i += 1) {
    const point = points[i]!;
    const significant =
      point.replay ||
      point.isMocked === true ||
      point.deliveryId != null ||
      point.trackingStatus !== anchor.trackingStatus ||
      point.activeDeliveryId !== anchor.activeDeliveryId;

    const ms = Date.parse(point.clientTs);
    const gap = Number.isFinite(ms) && Number.isFinite(anchorMs) ? ms - anchorMs : Infinity;
    const moved = trailDistanceMeters(anchor.lat, anchor.lng, point.lat, point.lng);

    if (significant || (gap >= FLUSH_MIN_GAP_MS && moved >= FLUSH_MIN_MOVE_M)) {
      kept.push(point);
      anchor = point;
      anchorMs = ms;
    }
  }

  kept.push(points[points.length - 1]!);
  return kept;
}
