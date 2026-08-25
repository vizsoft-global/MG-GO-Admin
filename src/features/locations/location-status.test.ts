import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LIVE_PIN_RETENTION_MS,
  derivePinStatus,
  gpsLiveMaxAgeMs,
  isGpsLive,
  isPinBeyondRetention,
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
    assert.ok(gpsLiveMaxAgeMs() < 9 * 60_000);
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
        lastSeenAt: isoMinutesAgo(2),
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

  it("does not keep leftover delivery_submit green after the pickup ends", () => {
    const fresh = new Date(Date.now() - 10_000).toISOString();
    assert.equal(
      derivePinStatus({
        zoneStatus: "in_zone",
        trackingStatus: "delivery_submit",
        lastSeenAt: fresh,
        isOnDuty: true,
        speedMps: 0,
        activeDeliveryId: null,
      }),
      "idle",
    );
  });

  it("keeps an open pickup pin active", () => {
    const fresh = new Date(Date.now() - 10_000).toISOString();
    assert.equal(
      derivePinStatus({
        zoneStatus: "in_zone",
        trackingStatus: "delivery_submit",
        lastSeenAt: fresh,
        isOnDuty: true,
        speedMps: 0,
        activeDeliveryId: "del-1",
      }),
      "active",
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

  it("gives a parked rider the idle grace and a moving one the tight window", () => {
    // The driver app reports every second while moving and every 30s otherwise, so the same
    // silence means different things. V1 held a flat 8 minutes here, which is why its list
    // still called a rider live long after V2 had them as GPS Offline.
    const twoMinutes = isoMinutesAgo(2);
    assert.equal(isGpsLive(twoMinutes, NOW, null, "idle", 0), true);
    assert.equal(isGpsLive(twoMinutes, NOW, null, "moving", 9), false);
  });

  it("agrees with V2 on where the idle grace ends", () => {
    assert.equal(gpsLiveMaxAgeMs("idle", 0), 150_000);
    assert.equal(gpsLiveMaxAgeMs("moving", 9), 90_000);
    // Real motion under an idle stamp is the moving cadence.
    assert.equal(gpsLiveMaxAgeMs("idle", 9), 90_000);
    // A caller with nothing to say gets the conservative window.
    assert.equal(gpsLiveMaxAgeMs(), 150_000);
  });

  it("keeps a pin long past the point where its reading stops being live", () => {
    // Retention and liveness answer different questions: calling a reading stale is a label,
    // dropping the row takes the driver off the map.
    const fiveMinutes = isoMinutesAgo(5);
    assert.equal(isGpsLive(fiveMinutes, NOW), false);
    assert.equal(isPinBeyondRetention(fiveMinutes, NOW), false);
    assert.equal(isPinBeyondRetention(isoMinutesAgo(9), NOW), true);
    assert.ok(LIVE_PIN_RETENTION_MS > gpsLiveMaxAgeMs());
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
    vehicleType: "bike" as const,
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
