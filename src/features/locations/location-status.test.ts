import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LIVE_GPS_MAX_AGE_MS, isGpsLive, shouldShowOnLiveMap } from "./location-status";

const NOW = Date.parse("2026-08-13T09:00:00.000Z");

function isoMinutesAgo(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString();
}

describe("shouldShowOnLiveMap", () => {
  it("hides off-duty drivers after the live GPS window", () => {
    assert.equal(
      shouldShowOnLiveMap(
        { lastSeenAt: isoMinutesAgo(9), isOnDuty: false },
        NOW,
      ),
      false,
    );
  });

  it("keeps on-duty drivers at last known coords after the live GPS window", () => {
    assert.equal(
      shouldShowOnLiveMap(
        { lastSeenAt: isoMinutesAgo(9), isOnDuty: true },
        NOW,
      ),
      true,
    );
    assert.equal(isGpsLive(isoMinutesAgo(9), NOW), false);
    assert.ok(LIVE_GPS_MAX_AGE_MS < 9 * 60_000);
  });

  it("shows anyone with a fresh ping", () => {
    assert.equal(
      shouldShowOnLiveMap(
        { lastSeenAt: isoMinutesAgo(1), isOnDuty: false },
        NOW,
      ),
      true,
    );
  });
});
