import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ORDERS_REPORT_MAX_DAYS,
  assertDeliveryOrdersReportRange,
  attributeDeliveryShiftDate,
  inclusiveDayCount,
  ordersReportErrorKey,
} from "./orders-report-utils";

describe("inclusiveDayCount", () => {
  it("counts the year-to-date range the modal submits", () => {
    assert.equal(inclusiveDayCount("2026-01-01", "2026-08-24"), 236);
  });

  it("counts a single day as 1", () => {
    assert.equal(inclusiveDayCount("2026-08-24", "2026-08-24"), 1);
  });
});

describe("assertDeliveryOrdersReportRange", () => {
  it("allows the year-to-date range that timed out", () => {
    assert.doesNotThrow(() =>
      assertDeliveryOrdersReportRange("2026-01-01", "2026-08-24"),
    );
  });

  it("allows a leap-year span of 366 days", () => {
    assert.doesNotThrow(() =>
      assertDeliveryOrdersReportRange("2024-01-01", "2024-12-31"),
    );
    assert.equal(inclusiveDayCount("2024-01-01", "2024-12-31"), ORDERS_REPORT_MAX_DAYS);
  });

  it("rejects inverted or empty dates", () => {
    assert.throws(
      () => assertDeliveryOrdersReportRange("2026-08-24", "2026-01-01"),
      /invalid_date_range/,
    );
    assert.throws(() => assertDeliveryOrdersReportRange("", "2026-08-24"), /invalid_date_range/);
  });

  it("allows a same-day clock window", () => {
    assert.doesNotThrow(() =>
      assertDeliveryOrdersReportRange("2026-09-03", "2026-09-03", "08:00", "18:00"),
    );
  });

  it("rejects a same-day inverted clock", () => {
    assert.throws(
      () => assertDeliveryOrdersReportRange("2026-09-03", "2026-09-03", "18:00", "08:00"),
      /invalid_date_range/,
    );
  });

  it("rejects a missing or junk clock", () => {
    assert.throws(
      () => assertDeliveryOrdersReportRange("2026-09-03", "2026-09-03", "", "18:00"),
      /invalid_date_range/,
    );
    assert.throws(
      () => assertDeliveryOrdersReportRange("2026-09-03", "2026-09-03", "8:00", "18:00"),
      /invalid_date_range/,
    );
  });

  it("rejects more than 366 inclusive days", () => {
    assert.throws(
      () => assertDeliveryOrdersReportRange("2025-01-01", "2026-01-02"),
      /range_too_large/,
    );
  });
});

describe("attributeDeliveryShiftDate", () => {
  const windows = [
    {
      shiftDate: "2026-08-20",
      windowStartMs: Date.parse("2026-08-20T05:00:00+03:00"),
      windowEndMs: Date.parse("2026-08-20T14:00:00+03:00"),
    },
    {
      shiftDate: "2026-08-21",
      windowStartMs: Date.parse("2026-08-21T05:00:00+03:00"),
      windowEndMs: Date.parse("2026-08-21T14:00:00+03:00"),
    },
  ];

  it("uses the earliest window that contains the delivery", () => {
    assert.equal(
      attributeDeliveryShiftDate(Date.parse("2026-08-21T09:00:00+03:00"), "2026-08-21", windows),
      "2026-08-21",
    );
  });

  it("falls back to the latest window that started before the delivery", () => {
    assert.equal(
      attributeDeliveryShiftDate(Date.parse("2026-08-21T20:00:00+03:00"), "2026-08-21", windows),
      "2026-08-21",
    );
  });

  it("falls back to the nearest window when none have started yet", () => {
    assert.equal(
      attributeDeliveryShiftDate(Date.parse("2026-08-19T20:00:00+03:00"), "2026-08-19", windows),
      "2026-08-20",
    );
  });

  it("uses the Kuwait calendar day when the driver has no shift windows", () => {
    assert.equal(
      attributeDeliveryShiftDate(Date.parse("2026-08-21T09:00:00+03:00"), "2026-08-21", []),
      "2026-08-21",
    );
  });
});

describe("ordersReportErrorKey", () => {
  it("maps timeout and range errors to specific copy", () => {
    assert.equal(ordersReportErrorKey(new Error("range_too_large")), "rangeTooLarge");
    assert.equal(
      ordersReportErrorKey(new Error("canceling statement due to statement timeout")),
      "failed",
    );
    assert.equal(ordersReportErrorKey(new Error("invalid_date_range")), "invalidRange");
  });
});
