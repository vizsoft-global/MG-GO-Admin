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

const POLL_MS = 10_000;
const ROSTER_MS = 120_000;

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

let activeTransport: FleetTransport | null = null;

afterEach(() => {
  activeTransport?.stop();
  activeTransport = null;
  snapshotCalls.length = 0;
  mock.timers.reset();
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
