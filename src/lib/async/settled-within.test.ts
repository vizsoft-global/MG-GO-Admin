import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { settledWithin } from "./settled-within";

describe("settledWithin", () => {
  it("returns the value when it finishes in time", async () => {
    const result = await settledWithin(Promise.resolve(7), 50);
    assert.deepEqual(result, { ok: true, value: 7 });
  });

  it("gives up when the thenable never settles", async () => {
    const hung = new Promise<number>(() => {});
    const result = await settledWithin(hung, 20);
    assert.deepEqual(result, { ok: false });
  });

  it("treats a throw as a miss so the caller can fail open", async () => {
    const result = await settledWithin(Promise.reject(new Error("offline")), 50);
    assert.deepEqual(result, { ok: false });
  });
});
