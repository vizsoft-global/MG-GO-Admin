import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { DRIVER_ROSTER_GENERATION, DRIVER_ROSTER_SNAPSHOTS, SNAPSHOT_TTL_MS } from "./read-snapshot";
import {
  decodeStorable,
  driverRosterSnapshotEnabled,
  encodeStorable,
  packRoster,
  readThroughRoster,
  rosterDocId,
  rosterMemoUsable,
  unpackRoster,
  type RosterPartDoc,
  type RosterStoreBackend,
} from "./roster-snapshot";

function memoryRosterBackend() {
  const generations = new Map<string, number>();
  const docs = new Map<string, RosterPartDoc>();
  const counts = { generationReads: 0, docReads: 0, writes: 0 };
  const backend: RosterStoreBackend = {
    async generation(name) {
      counts.generationReads += 1;
      return generations.get(name) ?? 0;
    },
    async read(ids) {
      counts.docReads += ids.length;
      return ids.map((id) => docs.get(id) ?? null);
    },
    async write(rows) {
      counts.writes += rows.length;
      for (const row of rows) docs.set(row.id, row.doc);
    },
  };
  return {
    backend,
    docs,
    counts,
    bump(name: string) {
      generations.set(name, (generations.get(name) ?? 0) + 1);
    },
  };
}

const NAME = DRIVER_ROSTER_GENERATION;

/** Text gzip cannot shrink much, so a small part size forces several parts. */
function noisyRows(count: number): Record<string, unknown>[] {
  let seed = 7;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed.toString(36);
  };
  return Array.from({ length: count }, (_, index) => ({
    id: `row-${index}`,
    name: `${next()}${next()}${next()}`,
    at: new Date(1_700_000_000_000 + index * 1000),
    tags: [next(), next()],
    nested: { code: next(), n: index, none: null, yes: true },
  }));
}

describe("roster snapshot store", () => {
  const savedEnv = process.env.DRIVER_ROSTER_SNAPSHOT;
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.DRIVER_ROSTER_SNAPSHOT;
    else process.env.DRIVER_ROSTER_SNAPSHOT = savedEnv;
  });

  it("is off unless DRIVER_ROSTER_SNAPSHOT is exactly 1", () => {
    delete process.env.DRIVER_ROSTER_SNAPSHOT;
    assert.equal(driverRosterSnapshotEnabled(), false);
    for (const value of ["", "0", "true", "on", " 1"]) {
      process.env.DRIVER_ROSTER_SNAPSHOT = value;
      assert.equal(driverRosterSnapshotEnabled(), false, JSON.stringify(value));
    }
    process.env.DRIVER_ROSTER_SNAPSHOT = "1";
    assert.equal(driverRosterSnapshotEnabled(), true);
  });

  it("is not switched on by the platform the way the page snapshot is", () => {
    const saved = process.env.K_SERVICE;
    try {
      process.env.K_SERVICE = "adminapiscan";
      delete process.env.DRIVER_ROSTER_SNAPSHOT;
      assert.equal(driverRosterSnapshotEnabled(), false);
    } finally {
      if (saved === undefined) delete process.env.K_SERVICE;
      else process.env.K_SERVICE = saved;
    }
  });

  it("bumps the roster together with the two results cut from it", () => {
    assert.deepEqual([...DRIVER_ROSTER_SNAPSHOTS], [
      "driverRosterBase",
      "adminListDriversPage",
      "adminDriversFilterValues",
    ]);
    // The generation is not a handler: the router must not try to store under it.
    assert.equal(SNAPSHOT_TTL_MS[DRIVER_ROSTER_GENERATION], undefined);
  });

  it("carries dates, nulls, arrays and nested objects back unchanged", () => {
    const value = noisyRows(5);
    const encoded = encodeStorable(value);
    assert.notEqual(encoded, undefined);
    const back = decodeStorable(JSON.parse(JSON.stringify(encoded)));
    assert.deepEqual(back, value);
    assert.ok((back as { at: unknown }[])[0].at instanceof Date);
  });

  it("refuses a value JSON would change instead of storing a different one", () => {
    class Stamp {
      constructor(readonly seconds: number) {}
    }
    assert.equal(encodeStorable({ a: new Stamp(1) }), undefined);
    assert.equal(encodeStorable({ a: undefined }), undefined);
    assert.equal(encodeStorable([Number.NaN]), undefined);
    assert.equal(encodeStorable({ a: new Date(Number.NaN) }), undefined);
    assert.equal(encodeStorable({ a: () => 1 }), undefined);
    assert.equal(encodeStorable({ $rosterDate: 5 }), undefined);
    assert.equal(packRoster([{ a: new Stamp(1) }]), null);
  });

  it("serves the stored value with one generation read and one document read", async () => {
    const store = memoryRosterBackend();
    const rows = noisyRows(40);
    let loads = 0;
    const load = async () => {
      loads += 1;
      return rows;
    };
    const first = await readThroughRoster({ name: NAME, key: "k", ttlMs: 60_000, load, now: 1000 }, store.backend);
    assert.equal(first.outcome, "miss");
    assert.equal(first.stored, true);
    store.counts.generationReads = 0;
    store.counts.docReads = 0;

    const second = await readThroughRoster({ name: NAME, key: "k", ttlMs: 60_000, load, now: 2000 }, store.backend);
    assert.equal(second.outcome, "hit");
    assert.equal(loads, 1);
    assert.deepEqual(second.value, rows);
    assert.deepEqual(store.counts, { generationReads: 1, docReads: 1, writes: 1 });
    assert.equal(second.storeReads, 2);
    assert.equal(second.freshUntil, 61_000);
  });

  it("uses a generation the caller already read instead of reading it again", async () => {
    const store = memoryRosterBackend();
    const load = async () => ({ total: 3 });
    await readThroughRoster({ name: NAME, key: "kpis", ttlMs: 60_000, load, generation: 0 }, store.backend);
    const hit = await readThroughRoster({ name: NAME, key: "kpis", ttlMs: 60_000, load, generation: 0 }, store.backend);
    assert.equal(hit.outcome, "hit");
    assert.equal(store.counts.generationReads, 0);
    assert.equal(hit.storeReads, 1);
  });

  it("rebuilds on the next read after a bump", async () => {
    const store = memoryRosterBackend();
    let version = 1;
    const load = async () => [{ id: "a", version }];
    await readThroughRoster({ name: NAME, key: "k", ttlMs: 600_000, load, now: 1000 }, store.backend);
    version = 2;
    const stale = await readThroughRoster({ name: NAME, key: "k", ttlMs: 600_000, load, now: 2000 }, store.backend);
    assert.deepEqual(stale.value, [{ id: "a", version: 1 }]);

    store.bump(NAME);
    const rebuilt = await readThroughRoster({ name: NAME, key: "k", ttlMs: 600_000, load, now: 3000 }, store.backend);
    assert.equal(rebuilt.outcome, "miss");
    assert.equal(rebuilt.generation, 1);
    assert.deepEqual(rebuilt.value, [{ id: "a", version: 2 }]);

    const after = await readThroughRoster({ name: NAME, key: "k", ttlMs: 600_000, load, now: 4000 }, store.backend);
    assert.equal(after.outcome, "hit");
    assert.deepEqual(after.value, [{ id: "a", version: 2 }]);
  });

  it("rebuilds once the time limit has passed even with no bump", async () => {
    const store = memoryRosterBackend();
    let loads = 0;
    const load = async () => {
      loads += 1;
      return [loads];
    };
    await readThroughRoster({ name: NAME, key: "k", ttlMs: 1000, load, now: 0 }, store.backend);
    const late = await readThroughRoster({ name: NAME, key: "k", ttlMs: 1000, load, now: 1000 }, store.backend);
    assert.equal(late.outcome, "miss");
    assert.deepEqual(late.value, [2]);
  });

  it("splits a value that does not fit one document and reads every part back", async () => {
    const store = memoryRosterBackend();
    const rows = noisyRows(400);
    const packed = packRoster(rows, 2000, 64);
    assert.ok(packed);
    assert.ok(packed.chunks.length > 2, `parts: ${packed.chunks.length}`);
    assert.ok(packed.chunks.every((chunk) => chunk.length <= 2000));

    const input = { name: NAME, key: "k", ttlMs: 60_000, load: async () => rows, partBytes: 2000, maxParts: 64 };
    const first = await readThroughRoster({ ...input, now: 0 }, store.backend);
    assert.equal(first.stored, true);
    assert.equal(store.docs.size, packed.chunks.length);

    let loads = 0;
    const second = await readThroughRoster(
      { ...input, now: 1, load: async () => { loads += 1; return rows; } },
      store.backend,
    );
    assert.equal(second.outcome, "hit");
    assert.equal(loads, 0);
    assert.deepEqual(second.value, rows);
    assert.equal(second.storeReads, 1 + packed.chunks.length);
  });

  it("does not store a value above the part limit, and still answers", async () => {
    const store = memoryRosterBackend();
    const rows = noisyRows(400);
    assert.equal(packRoster(rows, 2000, 2), null);
    let loads = 0;
    const input = {
      name: NAME,
      key: "k",
      ttlMs: 60_000,
      partBytes: 2000,
      maxParts: 2,
      load: async () => {
        loads += 1;
        return rows;
      },
    };
    const first = await readThroughRoster(input, store.backend);
    const second = await readThroughRoster(input, store.backend);
    assert.equal(first.stored, false);
    assert.equal(second.outcome, "miss");
    assert.equal(loads, 2);
    assert.equal(store.docs.size, 0);
    assert.deepEqual(second.value, rows);
  });

  it("falls through when a part is missing, altered or from another write", async () => {
    const rows = noisyRows(400);
    const input = { name: NAME, key: "k", ttlMs: 60_000, partBytes: 2000, maxParts: 64 };
    const head = rosterDocId(NAME, 0, "k");
    const damage: Record<string, (docs: Map<string, RosterPartDoc>) => void> = {
      "a missing part": (docs) => void docs.delete(`${head}-p1`),
      "an altered part": (docs) => {
        const part = docs.get(`${head}-p2`) as RosterPartDoc;
        const packed = Buffer.from(part.packed);
        packed[10] = packed[10] ^ 0xff;
        docs.set(`${head}-p2`, { ...part, packed });
      },
      "a part of another generation": (docs) => {
        const part = docs.get(`${head}-p1`) as RosterPartDoc;
        docs.set(`${head}-p1`, { ...part, generation: 9 });
      },
      "a head that is not gzip": (docs) => {
        const part = docs.get(head) as RosterPartDoc;
        docs.set(head, { ...part, packed: Buffer.from("not gzip at all"), parts: 1, bytes: 15 });
      },
      "a head with no part count": (docs) => {
        const part = docs.get(head) as RosterPartDoc;
        docs.set(head, { packed: part.packed, generation: 0, freshUntil: part.freshUntil });
      },
    };
    for (const [label, apply] of Object.entries(damage)) {
      const store = memoryRosterBackend();
      await readThroughRoster({ ...input, load: async () => rows, now: 0 }, store.backend);
      apply(store.docs);
      let loads = 0;
      const read = await readThroughRoster(
        { ...input, now: 1, load: async () => { loads += 1; return rows; } },
        store.backend,
      );
      assert.equal(read.outcome, "miss", label);
      assert.equal(loads, 1, label);
      assert.deepEqual(read.value, rows, label);
      // The miss repaired the stored copy.
      const again = await readThroughRoster({ ...input, now: 2, load: async () => [] }, store.backend);
      assert.equal(again.outcome, "hit", label);
      assert.deepEqual(again.value, rows, label);
    }
  });

  it("detects a changed byte even when the length still matches", () => {
    const packed = packRoster(noisyRows(20));
    assert.ok(packed);
    const altered = Buffer.from(packed.chunks[0]);
    altered[altered.length - 12] ^= 0x01;
    assert.equal(unpackRoster([altered], packed.bytes, packed.sha), undefined);
    assert.deepEqual(unpackRoster(packed.chunks, packed.bytes, packed.sha), noisyRows(20));
  });

  it("serves an instance's own copy only under the generation it was read at", () => {
    const entry = { generation: 3, freshUntil: 10_000 };
    assert.equal(rosterMemoUsable(entry, 3, 9_999), true);
    assert.equal(rosterMemoUsable(entry, 4, 9_999), false, "a bump on another instance");
    assert.equal(rosterMemoUsable(entry, 3, 10_000), false, "the time limit");
    assert.equal(rosterMemoUsable(undefined, 3, 0), false);
    // An entry kept by the path that has no generation is never served as stored.
    assert.equal(rosterMemoUsable({}, 0, 0), false);
  });

  it("answers from the loader when the store cannot be read or written", async () => {
    const broken: RosterStoreBackend = {
      async generation() {
        throw new Error("generation down");
      },
      async read() {
        throw new Error("read down");
      },
      async write() {
        throw new Error("write down");
      },
    };
    const noGeneration = await readThroughRoster(
      { name: NAME, key: "k", ttlMs: 1000, load: async () => ["direct"] },
      broken,
    );
    assert.deepEqual(noGeneration.value, ["direct"]);
    assert.equal(noGeneration.generation, null);
    assert.equal(noGeneration.stored, false);

    const noDocs = await readThroughRoster(
      { name: NAME, key: "k", ttlMs: 1000, load: async () => ["direct"], generation: 4 },
      broken,
    );
    assert.deepEqual(noDocs.value, ["direct"]);
    assert.equal(noDocs.outcome, "miss");
    assert.equal(noDocs.stored, false);
  });
});

/**
 * Every callable that changes what an Employees list row shows. A handler that
 * loses its wrapper leaves its edits waiting for the stored roster's time limit,
 * and nothing else would say so.
 */
const ROSTER_WRITERS: Record<string, string[]> = {
  "drivers-admin.ts": [
    "adminApproveDriver",
    "archiveDriverIntake",
    "restoreDriverIntake",
    "regenerateDriverAppPasscode",
  ],
  "drivers.ts": ["setDriverAccountStatus", "setDriverBlocked"],
  "driver-profile.ts": ["driverUpdateAvatar"],
  "payroll-edits.ts": ["adminSavePayrollIdentity"],
  "hr-payroll.ts": ["adminSaveHrPayrollCells"],
  "catalogs.ts": [
    "adminUpsertZone",
    "adminDeleteZone",
    "adminUpsertPartner",
    "adminDeletePartner",
    "adminUpsertRestaurant",
    "adminDeleteRestaurant",
  ],
  "rules.ts": ["adminUpsertSourceCompany"],
  "purge-entities.ts": [
    "adminPurgeDrivers",
    "adminPurgeIntakes",
    "adminPurgeRestaurants",
    "adminPurgeZones",
  ],
  "purge-all.ts": ["adminPurgeRunAll", "adminPurgeSelected", "adminPurgeFilteredRun"],
};

describe("roster writers", () => {
  for (const [file, names] of Object.entries(ROSTER_WRITERS)) {
    it(`${file}: ${names.length} callable(s) bump the stored roster`, () => {
      const source = readFileSync(join(__dirname, "..", "rpcs", file), "utf8");
      for (const name of names) {
        const wrapped = new RegExp(
          `export const ${name} = onCall\\(\\s*(\\{[^}]*\\},\\s*)?thenBumpDriverRoster\\(`,
        );
        assert.match(source, wrapped, `${name} in ${file}`);
      }
    });
  }

  it("bumps only after the handler has finished, and not when it throws", async () => {
    const { thenBumpDriverRoster } = await import("./read-snapshot");
    const source = readFileSync(join(__dirname, "read-snapshot.ts"), "utf8");
    const start = source.indexOf("export function thenBumpDriverRoster");
    assert.ok(start >= 0);
    const body = source.slice(start, source.indexOf("\n}", start));
    assert.ok(body.indexOf("await handler(request)") < body.indexOf("await bumpDriverRoster()"));
    assert.equal(body.includes("finally"), false);
    const failing = thenBumpDriverRoster(async () => {
      throw new Error("refused");
    });
    await assert.rejects(failing({} as never), /refused/);
  });
});
