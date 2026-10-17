import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { measureBlock, recordRead } from "../core/fs-metrics";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("fs metrics", () => {
  it("counts reads that do not overlap as sequential", async () => {
    const { metrics } = await measureBlock("seq", async () => {
      await recordRead(Promise.resolve(1), 2);
      await recordRead(Promise.resolve(1), 3);
    });
    assert.equal(metrics.reads, 2);
    assert.equal(metrics.docsRead, 5);
    assert.equal(metrics.sequentialAwaits, 2);
  });

  it("does not count overlapping reads as sequential", async () => {
    const { metrics } = await measureBlock("par", async () => {
      await Promise.all([
        recordRead(wait(30).then(() => 1), 1),
        recordRead(wait(30).then(() => 1), 1),
        recordRead(wait(30).then(() => 1), 4),
      ]);
    });
    assert.equal(metrics.reads, 3);
    assert.equal(metrics.docsRead, 6);
    assert.equal(metrics.sequentialAwaits, 0);
  });

  it("adds a nested block's reads to the enclosing handler", async () => {
    const outer = await measureBlock("outer", async () => {
      await recordRead(Promise.resolve(1), 5);
      await measureBlock("inner", async () => {
        await recordRead(Promise.resolve(1), 7);
      });
    });
    assert.equal(outer.metrics.reads, 2);
    assert.equal(outer.metrics.docsRead, 12);

    const inner = await measureBlock("inner-only", async () => {
      await recordRead(Promise.resolve(1), 7);
    });
    // The inner block reports its own reads and does not inherit the outer's.
    assert.equal(inner.metrics.docsRead, 7);
  });
});
