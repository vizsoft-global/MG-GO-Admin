import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countDeliveriesInWindow, deliveryActivityAt } from "./driver-delivery-counts";

describe("deliveryActivityAt", () => {
  it("prefers delivered, then pickup, then created", () => {
    assert.equal(
      deliveryActivityAt({
        created_at: "c",
        pickup_at: "p",
        delivered_at: "d",
      }),
      "d",
    );
    assert.equal(
      deliveryActivityAt({
        created_at: "c",
        pickup_at: "p",
        delivered_at: null,
      }),
      "p",
    );
    assert.equal(
      deliveryActivityAt({
        created_at: "c",
        pickup_at: null,
        delivered_at: null,
      }),
      "c",
    );
  });
});

describe("countDeliveriesInWindow", () => {
  const today = {
    start: "2026-08-18T00:00:00+03:00",
    end: "2026-08-18T23:59:59.999+03:00",
  };

  it("counts an assigned pending order in the window, not only delivered_at", () => {
    const rows = [
      {
        status: "pending",
        created_at: "2026-08-18T10:00:00+03:00",
        pickup_at: null,
        delivered_at: null,
      },
    ];
    assert.equal(countDeliveriesInWindow(rows, today.start, today.end), 1);
  });

  it("excludes cancelled rows", () => {
    const rows = [
      {
        status: "cancelled",
        created_at: "2026-08-18T10:00:00+03:00",
        pickup_at: null,
        delivered_at: null,
      },
    ];
    assert.equal(countDeliveriesInWindow(rows, today.start, today.end), 0);
  });

  it("excludes orders whose activity is outside the window", () => {
    const rows = [
      {
        status: "verified",
        created_at: "2026-08-10T10:00:00+03:00",
        pickup_at: "2026-08-10T11:00:00+03:00",
        delivered_at: "2026-08-10T12:00:00+03:00",
      },
    ];
    assert.equal(countDeliveriesInWindow(rows, today.start, today.end), 0);
  });

  it("counts a UTC timestamp that falls inside the Kuwait day", () => {
    const rows = [
      {
        status: "pending",
        created_at: "2026-08-17T21:30:00.000Z",
        pickup_at: null,
        delivered_at: null,
      },
    ];
    assert.equal(countDeliveriesInWindow(rows, today.start, today.end), 1);
  });
});
