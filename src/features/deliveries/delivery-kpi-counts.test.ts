import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  listTotalFromStatusCounts,
  parseDeliveriesStatusCounts,
  readExactCount,
} from "./delivery-kpi-counts";

describe("readExactCount", () => {
  it("returns the exact count when the query succeeded", () => {
    assert.equal(readExactCount({ count: 61718, error: null }), 61718);
  });

  it("treats a successful null count as 0", () => {
    assert.equal(readExactCount({ count: null, error: null }), 0);
  });

  it("throws when the count query failed", () => {
    assert.throws(
      () => readExactCount({ count: null, error: { message: "statement timeout" } }),
      /statement timeout/,
    );
  });
});

describe("parseDeliveriesStatusCounts", () => {
  it("reads the RPC object and maps list totals by status", () => {
    const counts = parseDeliveriesStatusCounts({
      total: 100,
      active: 4,
      verified: 80,
      pending: 10,
      rejected: 3,
      cancelled: 2,
      under_review: 1,
      in_progress: 15,
    });
    assert.equal(listTotalFromStatusCounts(counts, "all"), 100);
    assert.equal(listTotalFromStatusCounts(counts, "in_progress"), 15);
    assert.equal(listTotalFromStatusCounts(counts, "active"), 4);
    assert.equal(listTotalFromStatusCounts(counts, "verified"), 80);
  });

  it("treats missing or junk fields as 0", () => {
    assert.equal(parseDeliveriesStatusCounts(null).total, 0);
    assert.equal(parseDeliveriesStatusCounts({ total: "12.9" }).total, 12);
  });
});
