import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LIVE_GPS_MAX_AGE_MS,
  derivePinStatus,
  isGpsLive,
  latestGpsAt,
  liveLocationPayloadChanged,
  shouldShowOnLiveMap,
} from "./location-status";

const NOW = Date.parse("2026-08-13T09:00:00.000Z");

function isoMinutesAgo(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString();
}

describe("shouldShowOnLiveMap", () => {
  it("keeps off-duty drivers at last-known coords so Offline can list them", () => {
    assert.equal(
      shouldShowOnLiveMap(
        { lastSeenAt: isoMinutesAgo(9), isOnDuty: false },
        NOW,
      ),
      true,
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

describe("derivePinStatus", () => {
  it("does not keep a logged-out driver as an active/moving pin", () => {
    assert.equal(
      derivePinStatus({
        zoneStatus: "in_zone",
        trackingStatus: "moving",
        lastSeenAt: isoMinutesAgo(0.1),
        isOnDuty: false,
        speedMps: 8,
      }),
      "idle",
    );
  });

  it("keeps Idle yellow — stale-but-still-live GPS is not Alert red", () => {
    assert.equal(
      derivePinStatus({
        zoneStatus: "in_zone",
        trackingStatus: "idle",
        lastSeenAt: isoMinutesAgo(3),
        isOnDuty: true,
        speedMps: 0,
      }),
      "idle",
    );
  });

  it("does not keep a leftover Moving stamp green after GPS goes stale", () => {
    assert.equal(
      derivePinStatus({
        zoneStatus: "in_zone",
        trackingStatus: "moving",
        lastSeenAt: isoMinutesAgo(9),
        isOnDuty: true,
        speedMps: 8,
      }),
      "idle",
    );
  });

  it("uses Alert only for a live out-of-zone pin", () => {
    assert.equal(
      derivePinStatus({
        zoneStatus: "out_of_zone",
        trackingStatus: "idle",
        lastSeenAt: new Date(Date.now() - 10_000).toISOString(),
        isOnDuty: true,
        speedMps: 0,
      }),
      "alert",
    );
  });
});

describe("latestGpsAt / isGpsLive", () => {
  it("treats a fresh last_report_at heartbeat as live even if last_seen_at froze", () => {
    const frozen = isoMinutesAgo(9);
    const heartbeat = isoMinutesAgo(0.5);
    assert.equal(latestGpsAt(frozen, heartbeat), heartbeat);
    assert.equal(isGpsLive(frozen, NOW, heartbeat), true);
    assert.equal(isGpsLive(frozen, NOW), false);
  });
});

describe("liveLocationPayloadChanged", () => {
  const base = {
    latitude: 29.3759,
    longitude: 47.9774,
    trackingStatus: "idle" as const,
    zoneStatus: "in_zone" as const,
    pinStatus: "idle" as const,
    isOnDuty: true,
    isBlocked: false,
    speedMps: 0,
    batteryPct: 80,
    activeDeliveryId: null,
    lastSeenAt: "2026-08-13T09:00:00.000Z",
  };

  it("notifies on any coordinate or last-seen change so the map pin can travel", () => {
    assert.equal(liveLocationPayloadChanged(undefined, base), true);
    assert.equal(liveLocationPayloadChanged(base, base), false);
    assert.equal(
      liveLocationPayloadChanged(base, { ...base, latitude: 29.376 }),
      true,
    );
    assert.equal(
      liveLocationPayloadChanged(base, {
        ...base,
        lastSeenAt: "2026-08-13T09:00:05.000Z",
      }),
      true,
    );
    assert.equal(
      liveLocationPayloadChanged(base, {
        ...base,
        trackingStatus: "moving",
      }),
      true,
    );
  });
});
