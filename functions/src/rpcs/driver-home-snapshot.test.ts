import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  homeSnapshotId,
  liveOpenSeconds,
  snapshotFresh,
  snapshotMismatchFields,
  type HomeSourceValues,
} from "./driver-home";

function values(overrides: Partial<HomeSourceValues> = {}): HomeSourceValues {
  return {
    today: "2026-10-17",
    weekStart: "2026-10-11",
    zoneId: "zone-1",
    partnerId: "partner-1",
    restaurantIds: ["r1", "r2"],
    forceAppUpdate: false,
    forceMin: null,
    partnerName: "Partner",
    partnerLogoUrl: null,
    sessionOnline: true,
    wentOnlineAt: "2026-10-17T05:00:00.000Z",
    openSince: "2026-10-17T05:00:00.000Z",
    speedMps: 0,
    distanceTodayMeters: 1200,
    earnings: 12.5,
    deliveries: 7,
    onlineSeconds: 3600,
    elapsedBaseSeconds: 3000,
    performance: {
      total_deliveries: 100,
      verified_deliveries: 90,
      pending_deliveries: 5,
      rejected_deliveries: 5,
    },
    adherence: { minutes_late: 0, minutes_early_out: 0 },
    compliance: { invalid_days: 1, rejected_orders: 2, cancelled_orders: 3 },
    ...overrides,
  };
}

function snapshotDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    shift_date: "2026-10-17",
    zone_id: "zone-1",
    partner_id: "partner-1",
    updated_at_ms: Date.parse("2026-10-17T08:00:00.000Z"),
    ...overrides,
  };
}

const DRIVER = { zone_id: "zone-1", partner_id: "partner-1" };
const NOW = new Date("2026-10-17T08:10:00.000Z");
const TODAY = "2026-10-17";

describe("homeSnapshotId", () => {
  it("keys on the driver and the shift day, so a day rollover is a new document", () => {
    assert.equal(homeSnapshotId("d1", "2026-10-17"), "d1_2026-10-17");
    assert.notEqual(homeSnapshotId("d1", "2026-10-17"), homeSnapshotId("d1", "2026-10-18"));
  });
});

describe("snapshotFresh", () => {
  it("accepts a current-schema document from today for the same zone and partner", () => {
    assert.equal(snapshotFresh(snapshotDoc(), TODAY, NOW, DRIVER), true);
  });

  it("rejects a schema version the code does not understand", () => {
    assert.equal(snapshotFresh(snapshotDoc({ schema_version: 2 }), TODAY, NOW, DRIVER), false);
    assert.equal(snapshotFresh(snapshotDoc({ schema_version: undefined }), TODAY, NOW, DRIVER), false);
  });

  it("rejects yesterday's document even when the clock is barely past midnight", () => {
    assert.equal(snapshotFresh(snapshotDoc({ shift_date: "2026-10-16" }), TODAY, NOW, DRIVER), false);
  });

  it("rejects a document older than the 30 minute staleness window", () => {
    const stale = snapshotDoc({ updated_at_ms: NOW.getTime() - 30 * 60 * 1000 - 1 });
    assert.equal(snapshotFresh(stale, TODAY, NOW, DRIVER), false);
  });

  it("accepts a document at the edge of the window and one with a slightly fast clock", () => {
    const edge = snapshotDoc({ updated_at_ms: NOW.getTime() - 30 * 60 * 1000 });
    assert.equal(snapshotFresh(edge, TODAY, NOW, DRIVER), true);
    const fast = snapshotDoc({ updated_at_ms: NOW.getTime() + 30_000 });
    assert.equal(snapshotFresh(fast, TODAY, NOW, DRIVER), true);
  });

  it("rejects a zone or partner move, because the targets and rules changed", () => {
    assert.equal(snapshotFresh(snapshotDoc(), TODAY, NOW, { ...DRIVER, zone_id: "zone-2" }), false);
    assert.equal(snapshotFresh(snapshotDoc(), TODAY, NOW, { ...DRIVER, partner_id: "partner-2" }), false);
  });

  it("rejects a document a writer has invalidated, so the next call recomputes", () => {
    const invalidated = snapshotDoc({ stale: true, stale_reason: "complete", stale_at_ms: NOW.getTime() });
    assert.equal(snapshotFresh(invalidated, TODAY, NOW, DRIVER), false);
    assert.equal(snapshotFresh(snapshotDoc({ stale: false }), TODAY, NOW, DRIVER), true);
  });

  it("rejects a document with no readable updated_at_ms", () => {
    assert.equal(snapshotFresh(snapshotDoc({ updated_at_ms: undefined }), TODAY, NOW, DRIVER), false);
  });
});

describe("liveOpenSeconds", () => {
  it("returns zero when there is no open session", () => {
    assert.equal(liveOpenSeconds(null, TODAY, NOW), 0);
  });

  it("adds only the interval since the session opened", () => {
    assert.equal(liveOpenSeconds("2026-10-17T08:00:00.000Z", TODAY, NOW), 600);
  });

  it("never credits yesterday's open interval to today", () => {
    assert.equal(liveOpenSeconds("2026-10-16T20:00:00.000Z", TODAY, NOW), 0);
  });

  it("ignores an unparseable instant instead of returning NaN", () => {
    assert.equal(liveOpenSeconds("not-a-date", TODAY, NOW), 0);
  });
});

describe("snapshotMismatchFields", () => {
  it("reports nothing when both paths agree", () => {
    assert.deepEqual(snapshotMismatchFields(values(), values()), []);
  });

  it("names the week count when the snapshot undercounts", () => {
    const fields = snapshotMismatchFields(values({ deliveries: 6 }), values());
    assert.deepEqual(fields, ["week.deliveries_count"]);
  });

  it("tolerates a two minute online-seconds drift and flags a five minute one", () => {
    assert.deepEqual(snapshotMismatchFields(values({ elapsedBaseSeconds: 3120 }), values()), []);
    assert.deepEqual(snapshotMismatchFields(values({ elapsedBaseSeconds: 3300 }), values()), [
      "today_online_seconds",
    ]);
  });

  it("flags a compliance or session disagreement", () => {
    const fields = snapshotMismatchFields(
      values({
        compliance: { invalid_days: 2, rejected_orders: 2, cancelled_orders: 3 },
        sessionOnline: false,
      }),
      values(),
    );
    assert.deepEqual(fields, ["week.compliance", "session.is_online"]);
  });

  it("flags a different restaurant assignment", () => {
    assert.deepEqual(snapshotMismatchFields(values({ restaurantIds: ["r1"] }), values()), [
      "restaurant_ids",
    ]);
  });
});
