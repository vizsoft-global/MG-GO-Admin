import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import { FleetStore } from "./fleet-store";
import { FleetTransport } from "./fleet-transport";

/**
 * `admin_live_fleet_snapshot` was measured as the single largest consumer in the project
 * (784,984 calls, ~313ms mean over its lifetime). A tracking tab left in the background
 * kept calling it on the poll cadence for the whole time the operator was elsewhere, so
 * the pause is the fix and these cases are what stop it regressing.
 *
 * The transport is exercised for real — a real `FleetStore`, the real timer wiring — with
 * the snapshot loader and the edge ticket stubbed. The stub counts snapshot calls, which
 * is the observable contract: no request while hidden, and exactly one catch-up on return.
 */

const POLL_MS = 60_000;
const ROSTER_MS = 120_000;
const WARM_GRACE_MS = 4_000;
const EMPTY_CHECK_MS = 5 * 60_000;

const snapshotCalls: string[] = [];

type DocumentStub = {
  setHidden: (hidden: boolean) => void;
  listenerCount: () => number;
};

const originalDocument = (globalThis as { document?: unknown }).document;

function installDocument(hidden: boolean): DocumentStub {
  const listeners = new Set<() => void>();
  const doc = {
    hidden,
    addEventListener: (type: string, listener: () => void) => {
      if (type === "visibilitychange") listeners.add(listener);
    },
    removeEventListener: (type: string, listener: () => void) => {
      if (type === "visibilitychange") listeners.delete(listener);
    },
  };
  (globalThis as { document?: unknown }).document = doc;
  return {
    setHidden(next: boolean) {
      doc.hidden = next;
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
  };
}

/** The rail that needs no Network Access, so `start()` settles without a socket. */
async function startTransport() {
  snapshotCalls.length = 0;
  const store = new FleetStore();
  const transport = new FleetTransport({
    store,
    fetchTicket: async () => ({ error: "fleet_edge_not_configured" }),
    snapshotLoader: async () => {
      snapshotCalls.push("admin_live_fleet_snapshot");
      return { data: null, error: null };
    },
  });
  await transport.start();
  return { store, transport };
}

/**
 * Enough of a browser socket for the edge rail: the test opens it and feeds it the
 * room's frames by hand.
 */
class FakeSocket {
  static readonly OPEN = 1;
  static last: FakeSocket | null = null;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  frame(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

const originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;

function riderMeta(idIdx: number, driverId: string) {
  return {
    idIdx,
    driverId,
    driverName: `Rider ${idIdx}`,
    driverCode: `R${idIdx}`,
    employeeId: null,
    avatarObjectKey: null,
    avatarUpdatedAt: null,
    zoneId: null,
    zoneName: null,
    partnerId: null,
    partnerName: null,
    restaurantName: null,
    vehicleLabel: null,
    accountStatus: "active",
    onDutySince: null,
    deliveriesToday: 0,
    deliveriesCompletedToday: 0,
    distanceTodayMeters: 0,
    batteryPct: null,
    accuracyMeters: null,
    activeDeliveryId: null,
    currentZoneId: null,
    currentZoneName: null,
    shiftStartAt: null,
    shiftEndAt: null,
    lastFixAt: null,
    status: "offline",
    flagBits: 0,
  };
}

/** The edge rail, with the socket left for the test to open. */
async function startEdgeTransport() {
  snapshotCalls.length = 0;
  FakeSocket.last = null;
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket;
  const store = new FleetStore();
  const transport = new FleetTransport({
    store,
    fetchTicket: async () => ({
      token: "t",
      wsUrl: "wss://edge.test/ws",
      room: "fleet-test",
      expiresAt: Date.now() + 60_000,
    }),
    snapshotLoader: async () => {
      snapshotCalls.push("admin_live_fleet_snapshot");
      return { data: null, error: null };
    },
  });
  await transport.start();
  const socket = FakeSocket.last;
  assert.ok(socket, "the transport opened an edge socket");
  return { store, transport, socket };
}

/**
 * Advances the clock the way a live room would see it: a frame every few seconds.
 * A socket that goes fifteen seconds without one is closed as stalled, which is
 * its own rail change and not what these cases are about.
 */
function advanceWithFrames(socket: FakeSocket, ms: number): void {
  const step = 5_000;
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    mock.timers.tick(Math.min(step, ms - elapsed));
    socket.frame({ t: "pong", ts: 0 });
  }
}

let activeTransport: FleetTransport | null = null;

afterEach(() => {
  activeTransport?.stop();
  activeTransport = null;
  snapshotCalls.length = 0;
  mock.timers.reset();
  if (originalWebSocket === undefined) {
    delete (globalThis as { WebSocket?: unknown }).WebSocket;
  } else {
    (globalThis as { WebSocket?: unknown }).WebSocket = originalWebSocket;
  }
  if (originalDocument === undefined) {
    delete (globalThis as { document?: unknown }).document;
  } else {
    (globalThis as { document?: unknown }).document = originalDocument;
  }
});

describe("FleetTransport background work", () => {
  it("polls on the cadence while the tab is visible", async () => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"] });
    const doc = installDocument(false);

    const { transport } = await startTransport();
    activeTransport = transport;
    assert.deepEqual(snapshotCalls, ["admin_live_fleet_snapshot"]);

    mock.timers.tick(POLL_MS);
    assert.equal(snapshotCalls.length, 2, "one poll fired");

    mock.timers.tick(POLL_MS);
    assert.equal(snapshotCalls.length, 3, "and again on the next cadence");

    assert.equal(doc.listenerCount(), 1, "the visibility listener is bound exactly once");
  });

  it("stops polling entirely while the tab is hidden", async () => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"] });
    const doc = installDocument(false);

    const { transport } = await startTransport();
    activeTransport = transport;
    const afterWarmStart = snapshotCalls.length;

    doc.setHidden(true);
    mock.timers.tick(POLL_MS * 3 + ROSTER_MS);

    assert.equal(
      snapshotCalls.length,
      afterWarmStart,
      "a hidden tab must not call admin_live_fleet_snapshot at all",
    );
  });

  it("runs exactly one catch-up pass when the tab comes back", async () => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"] });
    const doc = installDocument(false);

    const { transport } = await startTransport();
    activeTransport = transport;
    const afterWarmStart = snapshotCalls.length;

    doc.setHidden(true);
    mock.timers.tick(POLL_MS * 3);
    assert.equal(snapshotCalls.length, afterWarmStart, "still paused");

    doc.setHidden(false);
    assert.equal(
      snapshotCalls.length,
      afterWarmStart + 1,
      "returning catches up immediately rather than waiting out the cadence",
    );

    mock.timers.tick(POLL_MS);
    assert.equal(snapshotCalls.length, afterWarmStart + 2);
  });

  it("does not catch up after the transport has stopped", async () => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"] });
    const doc = installDocument(false);

    const { transport } = await startTransport();
    const afterWarmStart = snapshotCalls.length;

    transport.stop();
    assert.equal(doc.listenerCount(), 0, "the listener is released on stop");

    doc.setHidden(true);
    doc.setHidden(false);
    mock.timers.tick(POLL_MS * 2);

    assert.equal(snapshotCalls.length, afterWarmStart, "a stopped transport stays stopped");
  });
});

/**
 * A whole-fleet snapshot is 6,000-8,000 document reads. The room's socket carries the
 * same roster facts, so a healthy edge rail must not read the database at all — not to
 * warm up, not on a timer, not when the tab is looked at again.
 */
describe("FleetTransport edge rail reads nothing from the database", () => {
  it("does not fetch a snapshot before the socket has had its chance", async () => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"] });
    installDocument(false);

    const { transport } = await startEdgeTransport();
    activeTransport = transport;
    assert.equal(snapshotCalls.length, 0, "no warm-start read ahead of the edge");
  });

  it("never polls while the room is delivering the roster", async () => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"] });
    const doc = installDocument(false);

    const { store, transport, socket } = await startEdgeTransport();
    activeTransport = transport;
    socket.open();
    socket.frame({ t: "meta", drivers: [riderMeta(1, "d1"), riderMeta(2, "d2")] });
    assert.equal(store.getSnapshot().totalDrivers, 2, "the roster came from the socket");

    advanceWithFrames(socket, WARM_GRACE_MS);
    advanceWithFrames(socket, ROSTER_MS * 5);
    assert.equal(snapshotCalls.length, 0, "no roster refresh beside a healthy socket");

    doc.setHidden(true);
    advanceWithFrames(socket, POLL_MS);
    doc.setHidden(false);
    assert.equal(snapshotCalls.length, 0, "returning to the tab reads nothing either");
  });

  it("falls back to one snapshot when the socket leaves the map empty", async () => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"] });
    installDocument(false);

    const { transport } = await startEdgeTransport();
    activeTransport = transport;

    mock.timers.tick(WARM_GRACE_MS - 1);
    assert.equal(snapshotCalls.length, 0, "still inside the grace period");
    mock.timers.tick(1);
    assert.equal(snapshotCalls.length, 1, "the database is the floor under a silent edge");
  });

  it("re-checks an empty room slowly instead of polling it every minute", async () => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"] });
    installDocument(false);

    const { transport, socket } = await startEdgeTransport();
    activeTransport = transport;
    socket.open();

    advanceWithFrames(socket, WARM_GRACE_MS);
    const afterGrace = snapshotCalls.length;
    assert.equal(afterGrace, 1, "the grace read covers an edge with nothing to send");

    advanceWithFrames(socket, EMPTY_CHECK_MS - WARM_GRACE_MS - 10_000);
    assert.equal(snapshotCalls.length, afterGrace, "no per-minute poll of an empty room");

    advanceWithFrames(socket, 20_000);
    assert.equal(snapshotCalls.length, afterGrace + 1, "one slow re-check");
  });
});
