import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { earningsRecalcDateFromDeliveredAt } from "./delivery-earn-date";

describe("earningsRecalcDateFromDeliveredAt", () => {
  it("skips recalc when delivered_at is missing (cancelled / pending delete)", () => {
    assert.equal(earningsRecalcDateFromDeliveredAt(null), null);
    assert.equal(earningsRecalcDateFromDeliveredAt(undefined), null);
    assert.equal(earningsRecalcDateFromDeliveredAt(""), null);
  });

  it("uses the Kuwait calendar date of delivered_at", () => {
    assert.equal(
      earningsRecalcDateFromDeliveredAt("2026-08-11T08:00:00.000Z"),
      "2026-08-11",
    );
  });
});
