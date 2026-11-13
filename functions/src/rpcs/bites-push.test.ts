import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BITES_MIRROR_FIELDS as F } from "../core/bites";
import type { Firestore } from "../core/fs";
import { mirrorIdList, pushMirrorTargets } from "./bites-push";

const AT = new Date("2026-10-16T09:30:00.000Z");

type Write = { path: string; data: Record<string, unknown> };

/**
 * The same recording fake `bites-mirror.test.ts` uses: these tests assert which
 * document is written and which fields survive, not Firestore's behaviour.
 */
function fakeFirestore(options: {
  docs?: Record<string, Record<string, unknown>>;
  query?: Record<string, Record<string, unknown>[]>;
}) {
  const docs = options.docs ?? {};
  const writes: Write[] = [];
  const deletes: string[] = [];

  const docRef = (path: string) => ({
    path,
    get: async () => {
      const data = docs[path];
      return { exists: data !== undefined, data: () => data, ref: docRef(path) };
    },
    set: async (data: Record<string, unknown>) => {
      writes.push({ path, data });
    },
    delete: async () => {
      deletes.push(path);
    },
  });

  const makeQuery = (collectionName: string) => {
    let rows = options.query?.[collectionName] ?? [];
    const api = {
      where: (field: string, _op: string, value: unknown) => {
        rows = rows.filter((row) => row[field] === value);
        return api;
      },
      limit: () => api,
      get: async () => ({
        empty: rows.length === 0,
        size: rows.length,
        docs: rows.map((row, index) => ({
          id: `${collectionName}-${index}`,
          data: () => row,
          ref: docRef(`${collectionName}/${collectionName}-${index}`),
        })),
      }),
    };
    return api;
  };

  const collection = (name: string) => ({
    ...makeQuery(name),
    doc: (id: string) => docRef(`${name}/${id}`),
  });

  return {
    collection,
    batch: () => ({
      set: (ref: { path: string }, data: Record<string, unknown>) => writes.push({ path: ref.path, data }),
      delete: (ref: { path: string }) => deletes.push(ref.path),
      commit: async () => undefined,
    }),
    writes,
    deletes,
  } as unknown as Firestore & { writes: Write[]; deletes: string[] };
}

describe("mirrorIdList", () => {
  it("trims, dedupes, and treats a missing list as empty", () => {
    assert.deepEqual(mirrorIdList(undefined), []);
    assert.deepEqual(mirrorIdList(null), []);
    assert.deepEqual(mirrorIdList([]), []);
    assert.deepEqual(mirrorIdList([" r1 ", "r1", "", "r2"]), ["r1", "r2"]);
  });

  it("rejects a shape the caller cannot have meant", () => {
    assert.throws(() => mirrorIdList("r1"), /invalid_ids/);
    assert.throws(() => mirrorIdList([1]), /invalid_ids/);
    assert.throws(() => mirrorIdList(Array.from({ length: 201 }, (_v, i) => `r${i}`)), /too_many_ids/);
  });
});

describe("pushMirrorTargets", () => {
  it("repairs a store's link when only the restaurant is named", async () => {
    // The unassign case: the caller knows the store, not who is left on it.
    const db = fakeFirestore({
      docs: {
        "restaurants/r1": { name: "Rosy", external_merchant_id: "store-42" },
        "drivers/d9": { name: "Omar" },
      },
      query: { driver_restaurants: [{ driver_id: "d9", restaurant_id: "r1" }] },
    });
    const bites = fakeFirestore({});

    const counts = await pushMirrorTargets(db, { restaurantIds: ["r1"], driverIds: [] }, AT, bites);

    assert.deepEqual(counts, { restaurants: 1, drivers: 0 });
    const mirror = bites.writes.find((write) => write.path === "delivery_restaurants/r1");
    assert.equal(mirror?.data[F.externalMerchantId], "store-42");
    const link = bites.writes.find((write) => write.path === "delivery_partner_links/r1");
    assert.equal(link?.data[F.driverUid], "d9");
  });

  it("clears the rider when the store has no assignment left", async () => {
    const db = fakeFirestore({
      docs: { "restaurants/r1": { name: "Rosy", external_merchant_id: "store-42" } },
      query: { driver_restaurants: [] },
    });
    const bites = fakeFirestore({});

    await pushMirrorTargets(db, { restaurantIds: ["r1"], driverIds: [] }, AT, bites);

    const link = bites.writes.find((write) => write.path === "delivery_partner_links/r1");
    assert.equal(link?.data[F.driverUid], null);
  });

  it("refreshes the name and number on every store a rider holds", async () => {
    // The driver-edit case: the assignment did not move, the identity did.
    const db = fakeFirestore({
      docs: { "drivers/d1": { name: "Ali" }, "profiles/d1": { full_name: "Ali Hassan", phone: "965" } },
    });
    const bites = fakeFirestore({
      query: { delivery_partner_links: [{ driver_uid: "d1" }, { driver_uid: "d1" }] },
    });

    const counts = await pushMirrorTargets(db, { restaurantIds: [], driverIds: ["d1"] }, AT, bites);

    // One rider, but both of that rider's stores were rewritten.
    assert.deepEqual(counts, { restaurants: 0, drivers: 1 });
    assert.equal(bites.writes.length, 2);
    for (const write of bites.writes) {
      assert.equal(write.data[F.driverName], "Ali Hassan");
      assert.equal(write.data[F.driverPhone], "965");
    }
  });

  it("drops both mirror documents for a store that no longer exists", async () => {
    // The delete case: the panel removed the row, so the push has to clear it.
    const db = fakeFirestore({});
    const bites = fakeFirestore({});

    await pushMirrorTargets(db, { restaurantIds: ["r1"], driverIds: [] }, AT, bites);

    assert.deepEqual(bites.deletes.sort(), ["delivery_partner_links/r1", "delivery_restaurants/r1"]);
  });

  it("counts a Bites outage as zero rather than throwing at the caller", async () => {
    const db = fakeFirestore({ docs: { "restaurants/r1": { external_merchant_id: "store-1" } } });
    const unreachable = {
      collection: () => {
        throw new Error("bites unreachable");
      },
    } as unknown as Firestore;

    const counts = await pushMirrorTargets(db, { restaurantIds: ["r1"], driverIds: ["d1"] }, AT, unreachable);

    assert.deepEqual(counts, { restaurants: 0, drivers: 0 });
  });
});
