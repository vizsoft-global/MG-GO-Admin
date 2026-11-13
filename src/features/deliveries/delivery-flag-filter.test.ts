import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { flagFilterOf, needsMemoryFilter } from "./delivery-flag-filter";

/**
 * The delivery flag filter.
 *
 * The reported defect was that "Photo mismatch" returned the same rows as
 * "All flags". The row predicate was right; the *route* was the problem — any flag
 * short-circuited to a 20,000-document in-memory scan (measured 89.5 s), the
 * request died on the platform timeout, and the previous unfiltered page stayed on
 * screen. These cases pin the two halves of the fix: every flag becomes a single
 * equality on a boolean column, and a flag no longer forces the scan.
 */
describe("flagFilterOf", () => {
  it("maps each flag to an equality on its own boolean column", () => {
    assert.deepEqual(flagFilterOf("early_drop"), { field: "is_early_drop", value: true });
    assert.deepEqual(flagFilterOf("outside_zone"), { field: "is_out_of_zone", value: true });
    assert.deepEqual(flagFilterOf("photo_mismatch"), {
      field: "order_proof_ocr_matched",
      value: false,
    });
  });

  it("matches nothing for All flags", () => {
    assert.equal(flagFilterOf("all"), null);
    assert.equal(flagFilterOf(undefined), null);
  });

  it("matches an explicit false only for photo mismatch, never 'not true'", () => {
    /*
     * `order_proof_ocr_matched` is null on 19,895 of 20,000 production rows because
     * OCR only runs on a completed delivery, and null means "not checked", not
     * "mismatch". An `!= true` match would paint almost the whole fleet red.
     */
    assert.equal(flagFilterOf("photo_mismatch")?.value, false);
    assert.notEqual(flagFilterOf("photo_mismatch")?.value, true);
  });
});

describe("needsMemoryFilter", () => {
  it("does not scan for a flag", () => {
    // The whole point: a flag is an indexed equality now.
    assert.equal(needsMemoryFilter({ flags: "early_drop" }), false);
    assert.equal(needsMemoryFilter({ flags: "outside_zone" }), false);
    assert.equal(needsMemoryFilter({ flags: "photo_mismatch" }), false);
    assert.equal(needsMemoryFilter({ flags: "all" }), false);
  });

  it("still scans for free-text search and a cancel reason", () => {
    // Neither is a stored field, so rows have to be in hand to match them.
    assert.equal(needsMemoryFilter({ search: "ahmed" }), true);
    assert.equal(needsMemoryFilter({ cancelReason: "food_theft" }), true);
    assert.equal(needsMemoryFilter({ search: "  " }), false);
    assert.equal(needsMemoryFilter({ cancelReason: "all" }), false);
  });
});
