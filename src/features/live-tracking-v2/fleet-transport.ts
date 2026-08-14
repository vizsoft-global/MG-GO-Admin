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
  private reconnectHandle: ReturnType<typeof setTimeout> | null = null;

  private edgeAttempts = 0;
  private stopped = false;
  private lastFrameAt = 0;
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
      this.store.setConnection({ rail: "edge", status: "live", error: null, attempts: 0 });
      this.sendView();
      this.startPing();
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
      case "delta":
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

  private teardownEdge(): void {
    this.stopPing();
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
        this.store.applyMirror(payload);
        this.store.setRail("mirror", "live");
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
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
    } catch (error) {
      this.store.setConnection({ status: "error", error: String(error) });
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
