import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMPARISON_ERROR_KEYS,
  ComparisonReadCapError,
  comparisonErrorKeyFromMessage,
  failureCode,
  isComparisonErrorKey,
} from "./order-comparison-errors";
import { deliveryDayBounds } from "./order-comparison-range";

describe("comparison failure codes", () => {
  it("keeps the domain codes the callable raises", () => {
    for (const key of [
      "invalid_range",
      "range_too_large",
      "scan_cap_exceeded",
      "not_authorized",
      "not_configured",
    ] as const) {
      assert.equal(failureCode({ message: key }), key);
    }
  });

  it("treats a stale lane or a missing export as service_stale", () => {
    assert.equal(failureCode({ message: "wrong_lane" }), "service_stale");
    assert.equal(failureCode({ code: "404", message: "unknown_fn" }), "service_stale");
    assert.equal(
      failureCode({ message: "admin_order_comparison_snapshot is not on this lane" }),
      "service_stale",
    );
    assert.equal(
      failureCode({ message: "Could not find the function adminApiScan" }),
      "service_stale",
    );
    assert.equal(
      failureCode({ message: "admin_order_recon_compare is not on this lane" }),
      "service_stale",
    );
  });

  it("maps an HTTP 5xx to service_unavailable", () => {
    assert.equal(failureCode({ code: "500", message: "internal" }), "service_unavailable");
    assert.equal(failureCode({ code: "503", message: "" }), "service_unavailable");
  });

  it("maps a timed-out callable fetch to request_failed", () => {
    assert.equal(failureCode({ message: "unavailable" }), "request_failed");
  });

  it("falls back to compare_failed for anything it cannot name", () => {
    assert.equal(failureCode({ code: "403", message: "" }), "compare_failed");
    assert.equal(failureCode({ code: "401" }), "compare_failed");
    assert.equal(failureCode(null), "compare_failed");
    assert.equal(failureCode(undefined), "compare_failed");
    assert.equal(failureCode({ message: "   " }), "compare_failed");
  });

  it("never returns a key outside the message catalogue", () => {
    for (const key of COMPARISON_ERROR_KEYS) {
      assert.equal(isComparisonErrorKey(key), true);
    }
    assert.equal(isComparisonErrorKey("range_too_large_typo"), false);
  });
});

describe("comparison error key from a thrown action", () => {
  it("passes an exact key through", () => {
    assert.equal(comparisonErrorKeyFromMessage(new Error("scan_cap_exceeded")), "scan_cap_exceeded");
    assert.equal(comparisonErrorKeyFromMessage("service_stale"), "service_stale");
  });

  it("falls back for a transport error or an empty value", () => {
    assert.equal(
      comparisonErrorKeyFromMessage(new Error("Failed to fetch")),
      "compare_failed",
    );
    assert.equal(comparisonErrorKeyFromMessage(""), "compare_failed");
    assert.equal(comparisonErrorKeyFromMessage(null), "compare_failed");
    assert.equal(comparisonErrorKeyFromMessage({ message: "x" }), "compare_failed");
  });
});

describe("delivery fallback day bounds", () => {
  it("uses Kuwait midnight Date bounds, not ISO strings", () => {
    const bounds = deliveryDayBounds("2026-10-01", "2026-10-31");
    assert.equal(bounds.start instanceof Date, true);
    assert.equal(bounds.endExclusive instanceof Date, true);
    assert.equal(bounds.start.toISOString(), "2026-09-30T21:00:00.000Z");
    // `to` is inclusive: the exclusive end is the next Kuwait midnight.
    assert.equal(bounds.endExclusive.toISOString(), "2026-10-31T21:00:00.000Z");
  });

  it("rolls a month end into the next day", () => {
    const bounds = deliveryDayBounds("2026-12-31", "2026-12-31");
    assert.equal(bounds.start.toISOString(), "2026-12-30T21:00:00.000Z");
    assert.equal(bounds.endExclusive.toISOString(), "2026-12-31T21:00:00.000Z");
  });

  it("covers a full 93-day window without a gap", () => {
    const bounds = deliveryDayBounds("2026-01-01", "2026-04-03");
    assert.equal(bounds.start.toISOString(), "2025-12-31T21:00:00.000Z");
    assert.equal(bounds.endExclusive.toISOString(), "2026-04-03T21:00:00.000Z");
  });
});

describe("read cap error", () => {
  it("carries the key the action returns", () => {
    const error = new ComparisonReadCapError();
    assert.equal(error instanceof Error, true);
    assert.equal(error.message, "scan_cap_exceeded");
    assert.equal(error.name, "ComparisonReadCapError");
  });
});
