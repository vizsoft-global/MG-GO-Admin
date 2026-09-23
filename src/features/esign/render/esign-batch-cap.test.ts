import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BATCH_CAP,
  CHUNK_SIZE,
  computeBatchCap,
  computeChunkSize,
  ESTIMATED_COLD_MS,
  ESTIMATED_PER_ROW_MS,
} from "./esign-batch-cap";

describe("batch cap", () => {
  it("keeps the plan defaults until bench replaces them", () => {
    assert.equal(CHUNK_SIZE, 25);
    assert.equal(BATCH_CAP, 500);
    assert.equal(computeChunkSize(ESTIMATED_COLD_MS, ESTIMATED_PER_ROW_MS), 28);
    assert.equal(computeBatchCap(25), 500);
  });

  it("shrinks the chunk when per-row time is 2s", () => {
    assert.equal(computeChunkSize(5_000, 2_000), 18);
  });
});
