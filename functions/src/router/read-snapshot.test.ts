import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  packSnapshot,
  readThroughScanSnapshot,
  snapshotDocId,
  snapshotScope,
  stableArgs,
  unpackSnapshot,
  type ScanSnapshotBackend,
  type StoredSnapshot,
} from "./read-snapshot";

function memoryBackend(): ScanSnapshotBackend & { rows: Map<string, StoredSnapshot> } {
  const generations = new Map<string, number>();
  const rows = new Map<string, StoredSnapshot>();
  return {
    rows,
    async generation(fn) {
      return generations.get(fn) ?? 0;
    },
    async read(id) {
      return rows.get(id) ?? null;
    },
    async write(id, row) {
      rows.set(id, row);
    },
  };
}

describe("scan snapshot", () => {
  it("orders object keys so the same arguments share one document", () => {
    assert.equal(stableArgs({ b: 1, a: 2 }), stableArgs({ a: 2, b: 1 }));
    assert.equal(snapshotDocId("fn", "staff", 0, { b: 1 }), snapshotDocId("fn", "staff", 0, { b: 1 }));
    assert.notEqual(snapshotDocId("fn", "staff", 0, { a: 1 }), snapshotDocId("fn", "staff", 1, { a: 1 }));
  });

  it("keeps a partner payload off the staff document", () => {
    assert.equal(
      snapshotScope({
        isPartner: true,
        isSuperAdmin: false,
        isManager: false,
        partnerProjectKey: "keeta",
        uid: "p1",
      }),
      "partner:keeta",
    );
    assert.equal(
      snapshotScope({
        isPartner: false,
        isSuperAdmin: true,
        isManager: true,
        partnerProjectKey: null,
        uid: "admin",
      }),
      "staff",
    );
    assert.equal(
      snapshotScope({
        isPartner: false,
        isSuperAdmin: false,
        isManager: false,
        partnerProjectKey: null,
        uid: "user-1",
      }),
      "user:user-1",
    );
  });

  it("round-trips a handler result", () => {
    const packed = packSnapshot({ rows: [{ id: "a", n: 1 }], total: 1 });
    assert.ok(packed);
    assert.deepEqual(unpackSnapshot(packed), { rows: [{ id: "a", n: 1 }], total: 1 });
  });

  it("serves a fresh document without running the handler again", async () => {
    const backend = memoryBackend();
    let loads = 0;
    const first = await readThroughScanSnapshot(
      {
        fn: "adminPayrollMonthSnapshot",
        scope: "staff",
        args: { month: "2026-10" },
        now: 1_000,
        load: async () => {
          loads += 1;
          return { month: "2026-10", rows: 3 };
        },
      },
      backend,
    );
    const second = await readThroughScanSnapshot(
      {
        fn: "adminPayrollMonthSnapshot",
        scope: "staff",
        args: { month: "2026-10" },
        now: 2_000,
        load: async () => {
          loads += 1;
          return { month: "2026-10", rows: 9 };
        },
      },
      backend,
    );
    assert.equal(first.snapshot, "miss");
    assert.equal(second.snapshot, "hit");
    assert.deepEqual(second.value, { month: "2026-10", rows: 3 });
    assert.equal(loads, 1);
  });

  it("runs the handler when the stored result is past its TTL", async () => {
    const backend = memoryBackend();
    let loads = 0;
    await readThroughScanSnapshot(
      {
        fn: "adminListAttendanceDaily",
        scope: "staff",
        args: {},
        now: 0,
        load: async () => {
          loads += 1;
          return { rows: ["old"] };
        },
      },
      backend,
    );
    const again = await readThroughScanSnapshot(
      {
        fn: "adminListAttendanceDaily",
        scope: "staff",
        args: {},
        now: 61_000,
        load: async () => {
          loads += 1;
          return { rows: ["new"] };
        },
      },
      backend,
    );
    assert.equal(again.snapshot, "miss");
    assert.deepEqual(again.value, { rows: ["new"] });
    assert.equal(loads, 2);
  });

  it("does not cache the live fleet snapshot", async () => {
    const backend = memoryBackend();
    let loads = 0;
    const outcome = await readThroughScanSnapshot(
      {
        fn: "adminLiveFleetSnapshot",
        scope: "staff",
        args: {},
        load: async () => {
          loads += 1;
          return { drivers: 1 };
        },
      },
      backend,
    );
    assert.equal(outcome.snapshot, "skip");
    assert.equal(backend.rows.size, 0);
    assert.equal(loads, 1);
  });

  it("still returns the handler result when the cache read throws", async () => {
    const backend: ScanSnapshotBackend = {
      async generation() {
        throw new Error("firestore down");
      },
      async read() {
        return null;
      },
      async write() {
        throw new Error("firestore down");
      },
    };
    const outcome = await readThroughScanSnapshot(
      {
        fn: "adminPayrollRuleSnapshot",
        scope: "staff",
        args: { month: "2026-10" },
        load: async () => ({ ok: true }),
      },
      backend,
    );
    assert.equal(outcome.snapshot, "miss");
    assert.deepEqual(outcome.value, { ok: true });
  });
});
