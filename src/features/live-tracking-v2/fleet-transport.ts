/**
 * Three rails, in descending order of quality, chosen automatically.
 *
 * 1. **Edge WebSocket** (`edge`) — the Cloudflare room. 4Hz deltas, sub-second.
 * 2. **Supabase Broadcast mirror** (`mirror`) — ~1Hz, same data, different path.
 *    Only useful when the Worker is running but *this browser* cannot reach it:
 *    a proxy that blocks WebSockets to a third-party origin is the real case.
 *    It is produced by the Worker, so it is worthless when the Worker is down.
 * 3. **Snapshot polling** (`poll`) — `admin_live_fleet_snapshot` every 10s through
 *    Supabase. Slow, but it depends on nothing beyond the database, so it is the
 *    rail that is available when everything else is not.
 *
 * A snapshot is always fetched first, whichever rail wins: it is the only source of
 * roster facts the mirror lacks, and it means the map is populated before the socket
 * finishes its handshake.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RealtimeChannel } from "@supabase/supabase-js";

import type { FleetStore, FleetMirrorDriver, FleetSnapshotRow } from "./fleet-store";
import type { FleetZone } from "./fleet-types";
import type { ClientFrame, ServerFrame } from "./fleet-wire";
import type { FleetSocketTicket } from "./fleet-token";

const SNAPSHOT_POLL_MS = 10_000;
/** Warm-refresh cadence while a live rail is running: roster facts only. */
const ROSTER_REFRESH_MS = 120_000;
const PING_MS = 20_000;
/** No frame for this long means the socket is open but dead. */
const STALL_TIMEOUT_MS = 15_000;
const MAX_EDGE_ATTEMPTS = 3;

/**
 * How long the socket may carry no *positions* before the page stops treating it as a
 * live rail.
 *
 * A socket that answers `ping` with `pong` is not a socket that is delivering a fleet,
 * and the room sends nothing at all when it has nothing new — so a page whose drivers
 * are never published to the edge sat on a green "live" pill, with polling switched off
 * beneath it, and moved its pins only when the room next re-read the database. That is
 * how a rider whose app was never publishing to the edge looked like a rider standing
 * still. Positions are what makes this rail worth having, so positions are what its
 * health is measured in.
 *
 * 45s clears the app's 30s idle heartbeat plus slack, so a parked fleet is not mistaken
 * for a broken one.
 */
const POSITION_SILENCE_MS = 45_000;
const FLOW_WATCHDOG_MS = 5_000;

/**
 * How often statuses are re-aged locally. 1s so `gpsOfflineSeconds` lands within a second of
 * where it is documented to; anything coarser and the threshold becomes advisory.
 */
const STATUS_CLOCK_MS = 1_000;

/**
 * Channel name deliberately unlike v1's `admin-driver-locations`. Two pages on the
 * same Supabase project must not share a channel: a v1 tab and a v2 tab open side by
 * side would otherwise deliver each other's payloads.
 */
export function fleetMirrorTopic(room: string): string {
  return `fleet:${room}`;
}

export type FleetTransportOptions = {
  store: FleetStore;
  supabase: SupabaseClient;
  /** Injected so tests and the simulator can drive this without a browser. */
  fetchTicket?: () => Promise<FleetSocketTicket | { error: string }>;
  zonesLoader?: () => Promise<FleetZone[]>;
};

export class FleetTransport {
  private readonly store: FleetStore;
  private readonly supabase: SupabaseClient;
  private readonly fetchTicket: () => Promise<FleetSocketTicket | { error: string }>;
  private readonly zonesLoader: (() => Promise<FleetZone[]>) | null;

  private socket: WebSocket | null = null;
  private channel: RealtimeChannel | null = null;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private rosterHandle: ReturnType<typeof setInterval> | null = null;
  private pingHandle: ReturnType<typeof setInterval> | null = null;
  private flowHandle: ReturnType<typeof setInterval> | null = null;
  private statusClockHandle: ReturnType<typeof setInterval> | null = null;
  private reconnectHandle: ReturnType<typeof setTimeout> | null = null;

  private edgeAttempts = 0;
  private stopped = false;
  private lastFrameAt = 0;
  /** Last frame that actually carried a position, which is not the same as the last frame. */
  private lastLivePositionAt = 0;
  /** True while a live rail is connected but silent, and polling is covering for it. */
  private starved = false;
  private room = "fleet-kw";
  /** Set by the map; narrows what the room sends us. */
  private bbox: [number, number, number, number] | null = null;

  constructor(options: FleetTransportOptions) {
    this.store = options.store;
    this.supabase = options.supabase;
    this.fetchTicket = options.fetchTicket ?? defaultFetchTicket;
    this.zonesLoader = options.zonesLoader ?? null;

    this.store.onFiltersChanged = () => this.sendView();
  }

  async start(): Promise<void> {
    this.stopped = false;
    // Re-armed here, not only in the constructor: `stop()` clears it, and Strict Mode
    // runs mount effects twice, so a restarted transport must still follow filters.
    this.store.onFiltersChanged = () => this.sendView();
    this.startStatusClock();
    // Warm start first: an operator should see the fleet while the socket connects,
    // not an empty map with a spinner.
    await this.loadSnapshot();
    await this.connectEdge();
  }

  stop(): void {
    this.stopped = true;
    this.teardownEdge();
    this.teardownMirror();
    this.stopPolling();
    this.stopFlowWatchdog();
    this.stopStatusClock();
    if (this.rosterHandle) clearInterval(this.rosterHandle);
    this.rosterHandle = null;
    if (this.reconnectHandle) clearTimeout(this.reconnectHandle);
    this.reconnectHandle = null;
    this.store.onFiltersChanged = null;
    this.store.setRail("offline", "connecting");
  }

  /** Called by the map on idle; the room only sends what is on screen. */
  setViewport(bbox: [number, number, number, number] | null): void {
    this.bbox = bbox;
    this.sendView();
  }

  // -------------------------------------------------------------------------
  // Rail 1: edge socket
  // -------------------------------------------------------------------------

  private async connectEdge(): Promise<void> {
    if (this.stopped) return;

    let ticket: FleetSocketTicket | { error: string };
    try {
      ticket = await this.fetchTicket();
    } catch (error) {
      this.degradeFromEdge(String(error));
      return;
    }

    if ("error" in ticket) {
      // `fleet_edge_not_configured` is not a failure to retry — there is nothing at
      // the other end. Go straight to the rail that needs no edge.
      this.store.setConnection({ error: ticket.error });
      if (ticket.error === "fleet_edge_not_configured") {
        this.startPolling();
      } else {
        this.degradeFromEdge(ticket.error);
      }
      return;
    }

    this.room = ticket.room;
    this.edgeAttempts += 1;
    this.store.setConnection({ rail: "edge", status: "connecting", attempts: this.edgeAttempts });

    let socket: WebSocket;
    try {
      socket = new WebSocket(
        `${ticket.wsUrl}?token=${encodeURIComponent(ticket.token)}`,
      );
    } catch (error) {
      this.degradeFromEdge(String(error));
      return;
    }

    this.socket = socket;

    socket.onopen = () => {
      this.edgeAttempts = 0;
      this.lastFrameAt = Date.now();
      // Given, not assumed: the grace period starts now, so a fleet that is publishing
      // normally is never flagged during the handshake.
      this.lastLivePositionAt = Date.now();
      this.starved = false;
      this.store.setConnection({ rail: "edge", status: "live", error: null, attempts: 0 });
      this.sendView();
      this.startPing();
      this.startFlowWatchdog();
      // The socket replaces both fallbacks, but polling keeps running at a slow
      // cadence for roster facts the delta stream never carries (delivery counts,
      // distance today, shift changes).
      this.stopPolling();
      this.teardownMirror();
      this.startRosterRefresh();
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      this.lastFrameAt = Date.now();
      let frame: ServerFrame;
      try {
        frame = JSON.parse(event.data) as ServerFrame;
      } catch {
        return;
      }
      this.handleFrame(frame);
    };

    socket.onerror = () => {
      // `onclose` always follows, and it carries the code; handling both would
      // double-count the attempt.
    };

    socket.onclose = () => {
      this.stopPing();
      if (this.stopped) return;
      if (this.socket === socket) this.socket = null;
      this.degradeFromEdge("socket_closed");
    };
  }

  private handleFrame(frame: ServerFrame): void {
    switch (frame.t) {
      case "hello":
        this.store.applyHello({
          serverTime: frame.serverTime,
          frameHz: frame.frameHz,
          settings: frame.settings,
          zones: frame.zones,
        });
        break;
      case "meta":
        this.store.applyMeta(frame.drivers);
        break;
      case "trail":
        this.store.applyTrail({ tracks: frame.tracks });
        break;
      case "delta":
        // Only a frame with entries counts as flow. An empty delta is bookkeeping
        // (`gone` culls), and `pong` is proof of a socket, not of a fleet.
        if (frame.e.length > 0) this.noteLivePositions();
        this.store.applyDelta({ ts: frame.ts, e: frame.e, gone: frame.gone });
        break;
      case "events":
        this.store.applyFleetEvents(frame.events);
        break;
      case "ops":
        this.store.applyOpsEvents(frame.events);
        break;
      case "error":
        this.store.setConnection({ error: frame.code });
        break;
      default:
        break;
    }
  }

  private sendView(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const snapshot = this.store.getSnapshot();
    const frame: ClientFrame = {
      t: "view",
      bbox: this.bbox,
      statuses: snapshot.filters.statuses,
      zoneId: snapshot.filters.zoneId,
      partnerId: snapshot.filters.partnerId,
      // The selected driver is pinned server-side so following them across a pan
      // cannot drop them out of the frame.
      driverId: snapshot.selectedDriverId,
      search: snapshot.filters.search || null,
    };
    this.socket.send(JSON.stringify(frame));
  }

  private startPing(): void {
    this.stopPing();
    this.pingHandle = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      // A stalled socket does not close itself; without this check an operator would
      // watch a frozen map that still says "live".
      if (Date.now() - this.lastFrameAt > STALL_TIMEOUT_MS) {
        this.store.setConnection({ status: "degraded", error: "stalled" });
        this.socket.close();
        return;
      }
      this.socket.send(JSON.stringify({ t: "ping" } satisfies ClientFrame));
    }, PING_MS);
  }

  private stopPing(): void {
    if (this.pingHandle) clearInterval(this.pingHandle);
    this.pingHandle = null;
  }

  /**
   * Watches the live rail for *position* flow and puts snapshot polling underneath it
   * when there is none, without giving up the socket: the room may start delivering at
   * any moment, and until it does the database is a better floor than a frozen map.
   */
  private startFlowWatchdog(): void {
    this.stopFlowWatchdog();
    this.flowHandle = setInterval(() => this.checkLiveFlow(), FLOW_WATCHDOG_MS);
  }

  private stopFlowWatchdog(): void {
    if (this.flowHandle) clearInterval(this.flowHandle);
    this.flowHandle = null;
  }

  /**
   * Ages statuses on the page's own clock, on every rail and on none.
   *
   * Status normally arrives attached to a position, so a driver who stops reporting keeps the
   * status of their last frame — a rider whose phone died at speed stayed "Moving" until the
   * room next re-read the roster (up to 60s) or the next snapshot landed (10s). It runs here
   * rather than in the store so every timer on this page has one owner, and it runs
   * independently of the socket because a dead rail is exactly when it matters.
   */
  private startStatusClock(): void {
    this.stopStatusClock();
    this.statusClockHandle = setInterval(() => {
      if (this.stopped) return;
      this.store.tickStatusDecay();
    }, STATUS_CLOCK_MS);
  }

  private stopStatusClock(): void {
    if (this.statusClockHandle) clearInterval(this.statusClockHandle);
    this.statusClockHandle = null;
  }

  private noteLivePositions(): void {
    this.lastLivePositionAt = Date.now();
    if (!this.starved) return;
    this.starved = false;
    // Only the edge socket owns its own cadence. The mirror polls underneath by design,
    // because it carries no roster and no eviction.
    if (this.socket?.readyState === WebSocket.OPEN) this.stopPolling();
    this.store.setConnection({ status: "live", error: null });
  }

  private checkLiveFlow(): void {
    if (this.stopped || this.starved) return;
    const live =
      (this.socket && this.socket.readyState === WebSocket.OPEN) || this.channel != null;
    if (!live) return;
    // Nobody on duty means nobody should be publishing. Silence is the correct state of
    // an empty fleet, and calling it degraded would train operators to ignore the pill.
    if (this.store.getSnapshot().kpis.onDuty === 0) return;
    if (Date.now() - this.lastLivePositionAt < POSITION_SILENCE_MS) return;

    this.starved = true;
    this.store.setConnection({ status: "degraded", error: "no_live_positions" });
    this.startPolling();
  }

  private teardownEdge(): void {
    this.stopPing();
    this.stopFlowWatchdog();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onopen = null;
      try {
        socket.close();
      } catch {
        // Closing an already-closed socket is not an error worth surfacing.
      }
    }
    this.store.resetWireIds();
  }

  private degradeFromEdge(error: string): void {
    this.teardownEdge();
    this.store.setConnection({ status: "degraded", error });

    if (this.edgeAttempts < MAX_EDGE_ATTEMPTS) {
      // Exponential-ish, jittered: 500 admin tabs reconnecting in lockstep after a
      // Worker deploy would be a self-inflicted outage.
      const delay = Math.min(8_000, 500 * 2 ** this.edgeAttempts) + Math.random() * 400;
      this.reconnectHandle = setTimeout(() => void this.connectEdge(), delay);
      return;
    }

    this.startMirror();
  }

  // -------------------------------------------------------------------------
  // Rail 2: Supabase Broadcast mirror
  // -------------------------------------------------------------------------

  private startMirror(): void {
    if (this.stopped || this.channel) return;
    this.store.setRail("mirror", "connecting");
    // Polling runs underneath the mirror: the mirror has no roster and no eviction,
    // so on its own it would keep drawing a driver who clocked out.
    this.startPolling();

    const channel = this.supabase
      .channel(fleetMirrorTopic(this.room), { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "positions" }, (message) => {
        const payload = message.payload as
          | { ts: number; drivers: FleetMirrorDriver[] }
          | undefined;
        if (!payload?.drivers) return;
        this.lastFrameAt = Date.now();
        if (payload.drivers.length > 0) this.noteLivePositions();
        this.store.applyMirror(payload);
        this.store.setRail("mirror", "live");
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // Subscribed proves the channel, not the fleet — the mirror is produced by the
          // same room, so it is silent whenever the room is.
          this.lastLivePositionAt = Date.now();
          this.starved = false;
          this.startFlowWatchdog();
          this.store.setRail("mirror", "live");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          this.teardownMirror();
          this.store.setRail("poll", "degraded");
        }
      });

    this.channel = channel;
  }

  private teardownMirror(): void {
    if (!this.channel) return;
    void this.supabase.removeChannel(this.channel);
    this.channel = null;
  }

  // -------------------------------------------------------------------------
  // Rail 3: snapshot polling
  // -------------------------------------------------------------------------

  private startPolling(): void {
    if (this.pollHandle) return;
    if (this.store.getSnapshot().connection.rail === "offline") {
      this.store.setRail("poll", "live");
    }
    this.pollHandle = setInterval(() => void this.loadSnapshot(), SNAPSHOT_POLL_MS);
  }

  private stopPolling(): void {
    if (this.pollHandle) clearInterval(this.pollHandle);
    this.pollHandle = null;
  }

  private startRosterRefresh(): void {
    if (this.rosterHandle) return;
    this.rosterHandle = setInterval(() => void this.loadSnapshot(), ROSTER_REFRESH_MS);
  }

  private async loadSnapshot(): Promise<void> {
    try {
      const [snapshot, zones] = await Promise.all([
        this.supabase.rpc("admin_live_fleet_snapshot", { p_seen_within_minutes: 30 }),
        this.zonesLoader?.() ?? Promise.resolve(null),
      ]);

      if (snapshot.error) throw new Error(snapshot.error.message);
      const data = snapshot.data as {
        generated_at: string;
        settings: Record<string, number> | null;
        drivers: FleetSnapshotRow[];
      } | null;
      if (!data) return;

      this.store.applySnapshot({
        generatedAt: data.generated_at,
        settings: data.settings,
        drivers: data.drivers ?? [],
        zones: zones ?? undefined,
      });

      // Poll and warm-start have no socket, so the feed would stay empty without this.
      // On the edge rail it fills the gap until the first `ops` / `events` frame.
      void this.seedFeed();
    } catch (error) {
      this.store.setConnection({ status: "error", error: String(error) });
    }
  }

  private async seedFeed(): Promise<void> {
    try {
      const [fleet, ops] = await Promise.all([
        this.supabase.rpc("admin_list_fleet_events", { p_limit: 50 }),
        this.supabase
          .from("driver_operation_events")
          .select(
            "id, driver_id, category, operation_key, success, error_code, context, occurred_at",
          )
          .order("id", { ascending: false })
          .limit(50),
      ]);

      const fleetRows = (
        (fleet.data as { events?: Array<Record<string, unknown>> } | null)?.events ?? []
      ).map((event) => ({
        driverId: String(event.driver_id ?? ""),
        eventKey: String(event.event_key ?? ""),
        severity: (event.severity as "info" | "warning" | "critical") ?? "info",
        value: typeof event.value === "number" ? event.value : null,
        statusBefore: (event.status_before as string | null) ?? null,
        statusAfter: (event.status_after as string | null) ?? null,
        zoneId: (event.zone_id as string | null) ?? null,
        latitude: typeof event.latitude === "number" ? event.latitude : null,
        longitude: typeof event.longitude === "number" ? event.longitude : null,
        context: (event.context as Record<string, unknown>) ?? {},
        detectedAt: String(event.detected_at ?? new Date().toISOString()),
      }));
      if (fleetRows.length > 0) this.store.applyFleetEvents(fleetRows);

      const opsRows = (ops.data ?? []).map((event) => ({
        id: String(event.id),
        driverId: String(event.driver_id),
        category: String(event.category ?? ""),
        operationKey: String(event.operation_key ?? ""),
        success: event.success !== false,
        errorCode: (event.error_code as string | null) ?? null,
        context: (event.context as Record<string, unknown>) ?? {},
        occurredAt: String(event.occurred_at ?? new Date().toISOString()),
      }));
      if (opsRows.length > 0) this.store.applyOpsEvents(opsRows);
    } catch {
      // Feed seed is best-effort: a missing permission must not blank the map.
    }
  }
}

async function defaultFetchTicket(): Promise<FleetSocketTicket | { error: string }> {
  const response = await fetch("/api/live-tracking-v2/token", { method: "POST" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return { error: body?.error ?? `token_${response.status}` };
  }
  return (await response.json()) as FleetSocketTicket;
}
