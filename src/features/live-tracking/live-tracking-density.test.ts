import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMPACT_STAT_LABEL_CLASS,
  INSIGHTS_GRID_CLASS,
} from "./live-tracking-density";

describe("live tracking density", () => {
  it("does not truncate compact stat labels", () => {
    assert.equal(COMPACT_STAT_LABEL_CLASS.includes("truncate"), false);
    assert.match(COMPACT_STAT_LABEL_CLASS, /leading-tight/);
  });

  it("lets Fleet insights wrap instead of forcing six squeezed columns", () => {
    assert.match(INSIGHTS_GRID_CLASS, /grid-cols-2/);
    assert.doesNotMatch(INSIGHTS_GRID_CLASS, /^grid grid-cols-6 /);
  });
});
