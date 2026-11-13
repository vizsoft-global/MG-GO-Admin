import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createGeoMemo } from "./geo-memo";

describe("geo memo", () => {
  it("reads once inside the window and again after it", async () => {
    let clock = 0;
    let reads = 0;
    const memo = createGeoMemo({ ttlMs: 60_000, now: () => clock });
    const load = async () => ++reads;
    assert.equal(await memo("zone:a", load), 1);
    clock = 59_999;
    assert.equal(await memo("zone:a", load), 1);
    clock = 60_000;
    assert.equal(await memo("zone:a", load), 2);
    assert.equal(reads, 2);
  });

  it("keeps keys apart and shares one read between callers that arrive together", async () => {
    let reads = 0;
    const memo = createGeoMemo();
    const load = async () => ++reads;
    const [a, b, c] = await Promise.all([memo("zone:a", load), memo("zone:a", load), memo("zone:b", load)]);
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.equal(reads, 2);
  });

  it("does not remember a failed read", async () => {
    let fail = true;
    const memo = createGeoMemo();
    const load = async () => {
      if (fail) throw new Error("unavailable");
      return "ok";
    };
    await assert.rejects(memo("settings", load));
    fail = false;
    assert.equal(await memo("settings", load), "ok");
  });

  it("starts over instead of growing without limit", async () => {
    let reads = 0;
    const memo = createGeoMemo({ maxKeys: 2 });
    const load = async () => ++reads;
    await memo("a", load);
    await memo("b", load);
    await memo("c", load);
    await memo("a", load);
    assert.equal(reads, 4);
  });
});
