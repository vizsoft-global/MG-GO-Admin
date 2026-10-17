import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONFIG_CACHE_MAX_TTL_MS,
  configEpochs,
  createConfigCache,
  createKeyedEpochCache,
  emptyConfigEpochs,
  readConfigEpochs,
} from "./config-cache";
import type { Firestore } from "./fs";

const NOW = Date.parse("2026-10-17T09:00:00.000Z");

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("config cache", () => {
  it("fills once for an epoch and serves the same value inside the TTL", async () => {
    let now = NOW;
    let loads = 0;
    const cache = createConfigCache<{ rows: number[] }>({ ttlMs: 1_000, now: () => now });
    const load = async () => {
      loads += 1;
      return { rows: [1, 2, 3] };
    };
    const first = await cache.get(7, load);
    now += 10;
    const second = await cache.get(7, load);
    assert.equal(loads, 1);
    assert.equal(second, first);
    assert.equal(cache.peek(7), first);
  });

  it("drops the entry when the epoch moves", async () => {
    let loads = 0;
    const cache = createConfigCache<number>({ ttlMs: 1_000, now: () => NOW });
    const load = async () => {
      loads += 1;
      return loads;
    };
    assert.equal(await cache.get(1, load), 1);
    assert.equal(await cache.get(1, load), 1);
    assert.equal(await cache.get(2, load), 2);
    assert.equal(loads, 2);
    assert.equal(cache.peek(1), undefined);
  });

  it("expires an unchanged epoch after the hard TTL", async () => {
    let now = NOW;
    let loads = 0;
    const cache = createConfigCache<string>({ ttlMs: 50, now: () => now });
    const load = async () => {
      loads += 1;
      return `v${loads}`;
    };
    assert.equal(await cache.get(3, load), "v1");
    now += 49;
    assert.equal(await cache.get(3, load), "v1");
    now += 2;
    assert.equal(await cache.get(3, load), "v2");
    assert.equal(loads, 2);
  });

  it("shares one in-flight fill between concurrent callers on the same epoch", async () => {
    let loads = 0;
    const cache = createConfigCache<number>({ ttlMs: 1_000, now: () => NOW });
    const load = async () => {
      loads += 1;
      await wait(20);
      return 42;
    };
    const [a, b] = await Promise.all([cache.get(5, load), cache.get(5, load)]);
    assert.equal(a, 42);
    assert.equal(b, 42);
    assert.equal(loads, 1);
  });

  it("does not hand a fill for one epoch to a caller asking for another", async () => {
    const seen: number[] = [];
    const cache = createConfigCache<number>({ ttlMs: 1_000, now: () => NOW });
    const slow = async () => {
      seen.push(1);
      await wait(20);
      return 1;
    };
    const fast = async () => {
      seen.push(2);
      return 2;
    };
    const [a, b] = await Promise.all([cache.get(1, slow), cache.get(2, fast)]);
    assert.equal(a, 1);
    assert.equal(b, 2);
    assert.deepEqual(seen, [1, 2]);
    // One slot holds one epoch, and the slower fill finished last, so the slot
    // now holds epoch 1. A caller for epoch 2 must load again rather than be
    // handed the epoch-1 value that happens to be sitting in the slot.
    assert.equal(cache.peek(1), 1);
    assert.equal(cache.peek(2), undefined);
    assert.equal(await cache.get(2, fast), 2);
    assert.deepEqual(seen, [1, 2, 2]);
  });

  it("caps the key map and keeps the most recently used key", async () => {
    const cache = createKeyedEpochCache<string>({ ttlMs: 1_000, maxKeys: 2, now: () => NOW });
    const value = async (key: string) => key;
    await cache.get("a", 1, () => value("a"));
    await cache.get("b", 1, () => value("b"));
    assert.equal(cache.size(), 2);
    // Touch "a" so "b" becomes the coldest key.
    assert.equal(await cache.get("a", 1, () => value("a")), "a");
    let loads = 0;
    await cache.get("c", 1, async () => {
      loads += 1;
      return "c";
    });
    assert.equal(loads, 1);
    assert.equal(cache.size(), 2);
    assert.equal(cache.peek("a", 1), "a");
    assert.equal(cache.peek("b", 1), undefined);
    assert.equal(cache.peek("c", 1), "c");
  });

  it("clears one key or every key", async () => {
    const cache = createKeyedEpochCache<number>({ ttlMs: 1_000, now: () => NOW });
    await cache.get("a", 1, async () => 1);
    await cache.get("b", 1, async () => 2);
    cache.clear("a");
    assert.equal(cache.peek("a", 1), undefined);
    assert.equal(cache.peek("b", 1), 2);
    cache.clear();
    assert.equal(cache.size(), 0);
  });

  it("defaults the TTL to the five minute hard cap", async () => {
    let now = NOW;
    let loads = 0;
    const cache = createConfigCache<number>({ now: () => now });
    const load = async () => {
      loads += 1;
      return loads;
    };
    await cache.get(1, load);
    now += CONFIG_CACHE_MAX_TTL_MS - 1;
    await cache.get(1, load);
    assert.equal(loads, 1);
    now += 1;
    await cache.get(1, load);
    assert.equal(loads, 2);
  });
});

describe("config epochs", () => {
  it("reads only the counters that exist", () => {
    assert.deepEqual(emptyConfigEpochs(), { access: 0, settings: 0, menu: 0, config: 0 });
    assert.deepEqual(configEpochs(undefined), emptyConfigEpochs());
    assert.deepEqual(configEpochs({ access: 3, config: 9, junk: "x" }), {
      access: 3,
      settings: 0,
      menu: 0,
      config: 9,
    });
  });

  it("reads the epoch document once", async () => {
    let gets = 0;
    const db = {
      collection: () => ({
        doc: () => ({
          get: async () => {
            gets += 1;
            return { exists: true, data: () => ({ access: 1, settings: 2, menu: 3, config: 4 }) };
          },
        }),
      }),
    } as unknown as Firestore;
    assert.deepEqual(await readConfigEpochs(db), {
      access: 1,
      settings: 2,
      menu: 3,
      config: 4,
    });
    assert.equal(gets, 1);
  });
});
