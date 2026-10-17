import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import { BITES_MIRROR_FIELDS as F } from "../core/bites";
import type { Firestore } from "../core/fs";
import {
  bitesStoreIdOf,
  driverIdentityFrom,
  partnerLinkData,
  pushAssignmentMirror,
  pushDriverIdentityMirror,
  pushRestaurantMirror,
  restaurantMirrorData,
  storeNameKey,
  syncDriverAssignmentLink,
  syncDriverIdentity,
  syncRestaurantMirror,
} from "./bites-mirror";

const AT = new Date("2026-10-16T09:30:00.000Z");

/**
 * The push wrappers the admin RPCs call are the only client of these helpers, so they
 * are exercised against a recording fake rather than the emulator: the assertions that
 * matter are which document is written and which fields survive, not Firestore's
 * behaviour.
 */
type Write = { path: string; data: Record<string, unknown> };

function fakeFirestore(options: {
  docs?: Record<string, Record<string, unknown>>;
  query?: Record<string, Record<string, unknown>[]>;
  onWrite?: (write: Write) => void;
}) {
  const docs = options.docs ?? {};
  const query = options.query ?? {};
  const writes: Write[] = [];
  const deletes: string[] = [];

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

  const docRef = (path: string) => ({
    path,
    get: async () => {
      const data = docs[path];
      return { exists: data !== undefined, data: () => data, ref: docRef(path) };
    },
    set: async (data: Record<string, unknown>) => {
      const write = { path, data };
      writes.push(write);
      options.onWrite?.(write);
    },
    delete: async () => {
      deletes.push(path);
    },
  });

  const collection = (name: string) => ({
    ...makeQuery(name),
    doc: (id: string) => docRef(`${name}/${id}`),
  });

  const batch = () => ({
    set: (ref: { path: string }, data: Record<string, unknown>) => {
      const write = { path: ref.path, data };
      writes.push(write);
      options.onWrite?.(write);
    },
    commit: async () => undefined,
  });

  return { collection, batch, writes, deletes } as unknown as {
    collection: (name: string) => ReturnType<typeof collection>;
    batch: () => { set: (ref: { path: string }, data: Record<string, unknown>) => void; commit: () => Promise<void> };
    writes: Write[];
    deletes: string[];
  };
}

const bitesStore = { name: "Rosy Perfumes", external_merchant_id: "store-42" };

describe("bitesStoreIdOf", () => {
  it("reads the Bites store id off a restaurant row", () => {
    assert.equal(bitesStoreIdOf(bitesStore), "store-42");
    assert.equal(bitesStoreIdOf({ external_merchant_id: "   " }), null);
    assert.equal(bitesStoreIdOf(undefined), null);
  });
});

describe("driverIdentityFrom", () => {
  it("prefers the profile name and falls back across both phone fields", () => {
    assert.deepEqual(
      driverIdentityFrom("d1", { name: "Roster Ali", phone: "96511111111" }, { full_name: "Profile Ali" }),
      { uid: "d1", name: "Profile Ali", phone: "96511111111" },
    );
    assert.deepEqual(
      driverIdentityFrom("d1", { name: "Roster Ali", driver_phone: "96522222222" }, {}),
      { uid: "d1", name: "Roster Ali", phone: "96522222222" },
    );
    // The profile number wins so the panel's Call button and the customer app's
    // stamp cannot disagree on which number belongs to a rider.
    assert.deepEqual(
      driverIdentityFrom(
        "d1",
        { name: "Roster Ali", phone: "96511111111" },
        { full_name: "Profile Ali", phone: "96533333333" },
      ),
      { uid: "d1", name: "Profile Ali", phone: "96533333333" },
    );
    assert.deepEqual(driverIdentityFrom(null, undefined, undefined), {
      uid: null,
      name: null,
      phone: null,
    });
  });
});

describe("partnerLinkData", () => {
  const base = {
    storeId: "store-42",
    restaurantId: "r1",
    restaurantName: "Rosy",
    at: AT,
  };

  it("stamps assigned_at only when the rider changes", () => {
    const first = partnerLinkData({
      ...base,
      driver: { uid: "d1", name: "Ali", phone: "965" },
      previousDriverUid: null,
    });
    assert.equal(first[F.assignedAt] instanceof Timestamp, true);

    const same = partnerLinkData({
      ...base,
      driver: { uid: "d1", name: "Ali", phone: "965" },
      previousDriverUid: "d1",
    });
    // Re-running the mirror must not make an old assignment look fresh.
    assert.equal(F.assignedAt in same, false);

    const swapped = partnerLinkData({
      ...base,
      driver: { uid: "d2", name: "Omar", phone: "966" },
      previousDriverUid: "d1",
    });
    assert.equal(swapped[F.assignedAt] instanceof Timestamp, true);
    assert.equal(swapped[F.driverUid], "d2");
  });

  it("clears the rider fields when the store loses its driver", () => {
    const cleared = partnerLinkData({
      ...base,
      driver: { uid: null, name: null, phone: null },
      previousDriverUid: "d1",
    });
    assert.equal(cleared[F.driverUid], null);
    assert.equal(cleared[F.driverName], null);
    assert.equal(cleared[F.assignedAt], null);
  });
});

describe("restaurantMirrorData", () => {
  it("carries the store id the panel matches on", () => {
    assert.deepEqual(
      restaurantMirrorData({ restaurantId: "r1", name: "Rosy", externalMerchantId: "store-42", at: AT }),
      {
        [F.restaurantId]: "r1",
        [F.name]: "Rosy",
        [F.nameKey]: "rosy",
        [F.externalMerchantId]: "store-42",
        [F.updatedAt]: Timestamp.fromDate(AT),
      },
    );
  });
});

describe("storeNameKey", () => {
  it("folds case, spacing and punctuation so the panel can compare for equality", () => {
    assert.equal(storeNameKey("  Rosy  Perfumes "), "rosyperfumes");
    assert.equal(storeNameKey("ROSY-PERFUMES"), "rosyperfumes");
    assert.equal(storeNameKey("Rosy's Perfumes"), "rosysperfumes");
    // Arabic names must fold the same way rather than collapsing to an empty key.
    assert.equal(storeNameKey("روزي"), storeNameKey("روزي"));
    assert.notEqual(storeNameKey("روزي"), storeNameKey("عبير"));
    assert.equal(storeNameKey(null), "");
    assert.equal(storeNameKey("   "), "");
  });

  it("keeps two genuinely different stores apart", () => {
    assert.notEqual(storeNameKey("Rosy Perfumes"), storeNameKey("Rose Perfumes"));
  });
});

describe("syncDriverAssignmentLink", () => {
  it("writes the rider onto the store the restaurant is linked to", async () => {
    const db = fakeFirestore({
      docs: {
        "restaurants/r1": bitesStore,
        "drivers/d1": { name: "Ali", phone: "96511111111" },
        "profiles/d1": { full_name: "Ali Hassan" },
      },
    });
    const bites = fakeFirestore({});

    await syncDriverAssignmentLink(db as never, "r1", "d1", AT, bites as never);

    const link = bites.writes.find((write) => write.path.endsWith("/r1"));
    assert.ok(link);
    assert.equal(link.data[F.storeId], "store-42");
    assert.equal(link.data[F.driverUid], "d1");
    assert.equal(link.data[F.driverName], "Ali Hassan");
    assert.equal(link.data[F.driverPhone], "96511111111");
  });

  it("looks the rider up when the change carried no driver id", async () => {
    const db = fakeFirestore({
      docs: {
        "restaurants/r1": bitesStore,
        "drivers/d9": { name: "Omar" },
      },
      query: { driver_restaurants: [{ driver_id: "d9", restaurant_id: "r1" }] },
    });
    const bites = fakeFirestore({});

    await syncDriverAssignmentLink(db as never, "r1", null, AT, bites as never);

    const link = bites.writes.find((write) => write.path.endsWith("/r1"));
    assert.equal(link?.data[F.driverUid], "d9");
    assert.equal(link?.data[F.driverName], "Omar");
  });

  it("drops the mirror for a restaurant with no Bites store", async () => {
    const db = fakeFirestore({ docs: { "restaurants/r1": { name: "Unlinked" } } });
    const bites = fakeFirestore({});

    await syncDriverAssignmentLink(db as never, "r1", "d1", AT, bites as never);

    assert.deepEqual(bites.writes, []);
    assert.deepEqual(bites.deletes, ["delivery_partner_links/r1"]);
  });
});

describe("syncRestaurantMirror", () => {
  it("mirrors the row so store creation can refuse a duplicate", async () => {
    const db = fakeFirestore({
      docs: { "restaurants/r1": bitesStore, "drivers/d1": { name: "Ali" } },
      query: { driver_restaurants: [{ driver_id: "d1", restaurant_id: "r1" }] },
    });
    const bites = fakeFirestore({});

    await syncRestaurantMirror(db as never, "r1", bitesStore, AT, bites as never);

    const mirror = bites.writes.find((write) => write.path === "delivery_restaurants/r1");
    assert.equal(mirror?.data[F.externalMerchantId], "store-42");
    // The link must also pick up the current rider, not just the catalogue row.
    const link = bites.writes.find((write) => write.path === "delivery_partner_links/r1");
    assert.equal(link?.data[F.driverUid], "d1");
  });

  it("removes both mirror docs when the restaurant is deleted", async () => {
    const db = fakeFirestore({});
    const bites = fakeFirestore({});

    await syncRestaurantMirror(db as never, "r1", null, AT, bites as never);

    assert.deepEqual(bites.deletes.sort(), [
      "delivery_partner_links/r1",
      "delivery_restaurants/r1",
    ]);
  });
});

describe("syncDriverIdentity", () => {
  it("refreshes every link a rider is attached to", async () => {
    const db = fakeFirestore({
      docs: { "drivers/d1": { name: "Ali" }, "profiles/d1": { phone: "96533333333" } },
    });
    const bites = fakeFirestore({
      query: {
        delivery_partner_links: [
          { store_id: "store-1", driver_uid: "d1" },
          { store_id: "store-2", driver_uid: "d1" },
        ],
      },
    });

    const updated = await syncDriverIdentity(db as never, "d1", AT, bites as never);

    assert.equal(updated, 2);
    for (const write of bites.writes) {
      assert.equal(write.data[F.driverName], "Ali");
      assert.equal(write.data[F.driverPhone], "96533333333");
    }
  });

  it("writes nothing for a rider with no mirrored store", async () => {
    const bites = fakeFirestore({ query: { delivery_partner_links: [] } });
    const updated = await syncDriverIdentity(fakeFirestore({}) as never, "d1", AT, bites as never);
    assert.equal(updated, 0);
    assert.deepEqual(bites.writes, []);
  });
});

/** Anything the wrapper touches on the Bites project fails, as during an outage. */
function unreachableBites(): Firestore {
  return {
    collection: () => {
      throw new Error("bites unreachable");
    },
  } as unknown as Firestore;
}

describe("push wrappers", () => {
  it("mirrors a restaurant and reports success", async () => {
    const db = fakeFirestore({
      docs: {
        "restaurants/r1": { name: "Rosy", external_merchant_id: "store-1" },
        "driver_restaurants/r1_d1": { driver_id: "d1", restaurant_id: "r1" },
      },
    });
    const bites = fakeFirestore({});

    assert.equal(await pushRestaurantMirror(db as never, "r1", AT, bites as never), true);
    assert.ok(bites.writes.some((write) => write.path === "delivery_restaurants/r1"));
  });

  it("swallows a Bites failure so the admin write still succeeds", async () => {
    const db = fakeFirestore({ docs: { "restaurants/r1": { external_merchant_id: "store-1" } } });

    assert.equal(await pushRestaurantMirror(db as never, "r1", AT, unreachableBites()), false);
    assert.equal(await pushAssignmentMirror(db as never, "r1", "d1", AT, unreachableBites()), false);
    assert.equal(await pushDriverIdentityMirror(db as never, "d1", AT, unreachableBites()), false);
  });

  it("clears the link when the restaurant is gone", async () => {
    const db = fakeFirestore({});
    const bites = fakeFirestore({});

    assert.equal(await pushRestaurantMirror(db as never, "r1", AT, bites as never), true);
    assert.deepEqual(bites.deletes, ["delivery_restaurants/r1", "delivery_partner_links/r1"]);
  });
});
