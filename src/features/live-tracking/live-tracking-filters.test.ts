import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPolygonFeature } from "@/lib/geo/zone-geometry";
import {
  DEFAULT_LIVE_TRACKING_FILTERS,
  matchesLiveTrackingFilters,
  resetLiveTrackingFilters,
  type LiveTrackingFilterState,
} from "./live-tracking-filters";

const NOW = Date.parse("2026-08-13T12:00:00.000Z");
const fresh = new Date(NOW - 10_000).toISOString();

const kuwaitSquare = buildPolygonFeature([
  [29.3, 47.9],
  [29.3, 48.0],
  [29.4, 48.0],
  [29.4, 47.9],
]);

const zoneShapes = [
  {
    id: "zone-kuwait",
    zone_type: "polygon" as const,
    geometry: kuwaitSquare,
  },
];

function loc(overrides: Record<string, unknown> = {}) {
  return {
    driverName: "Ali",
    driverCode: "10084",
    isOnDuty: true,
    isBlocked: false,
    trackingStatus: "idle" as const,
    pinStatus: "idle" as const,
    batteryPct: 80,
    accuracyMeters: 20,
    zoneStatus: "in_zone" as const,
    speedMps: 0,
    lastSeenAt: fresh,
    latitude: 29.35,
    longitude: 47.95,
    ...overrides,
  };
}

function filters(
  overrides: Partial<LiveTrackingFilterState> = {},
): LiveTrackingFilterState {
  return { ...DEFAULT_LIVE_TRACKING_FILTERS, ...overrides };
}

describe("matchesLiveTrackingFilters zone", () => {
  it("keeps everyone when All zones is selected", () => {
    assert.equal(
      matchesLiveTrackingFilters(loc(), filters({ zoneId: "all" }), {
        zoneId: null,
        partnerId: null,
        zoneName: null,
      }, zoneShapes),
      true,
    );
  });

  it("matches a driver assigned to the selected zone even without GPS-in-polygon", () => {
    assert.equal(
      matchesLiveTrackingFilters(
        loc({ latitude: 12.9, longitude: 80.2 }),
        filters({ zoneId: "zone-kuwait" }),
        { zoneId: "zone-kuwait", partnerId: null, zoneName: "Kuwait" },
        zoneShapes,
      ),
      true,
    );
  });

  it("matches an unassigned driver whose GPS is inside the selected zone", () => {
    assert.equal(
      matchesLiveTrackingFilters(
        loc(),
        filters({ zoneId: "zone-kuwait" }),
        { zoneId: null, partnerId: null, zoneName: null },
        zoneShapes,
      ),
      true,
    );
  });

  it("hides an unassigned driver outside the selected zone", () => {
    assert.equal(
      matchesLiveTrackingFilters(
        loc({ latitude: 12.9, longitude: 80.2 }),
        filters({ zoneId: "zone-kuwait" }),
        { zoneId: null, partnerId: null, zoneName: null },
        zoneShapes,
      ),
      false,
    );
  });
});

describe("matchesLiveTrackingFilters status chips", () => {
  const meta = { zoneId: null, partnerId: null, zoneName: null };

  it("hides every driver when no status chip is selected", () => {
    assert.equal(
      matchesLiveTrackingFilters(loc(), filters({ statusChips: [] }), meta, zoneShapes, NOW),
      false,
    );
  });

  it("shows a GPS-live idle on-duty driver when only Online is selected", () => {
    assert.equal(
      matchesLiveTrackingFilters(
        loc({ isOnDuty: true, trackingStatus: "idle", speedMps: 0 }),
        filters({ statusChips: ["online"] }),
        meta,
        zoneShapes,
        NOW,
      ),
      true,
    );
  });

  it("hides a logged-out driver when only Online is selected", () => {
    assert.equal(
      matchesLiveTrackingFilters(
        loc({ isOnDuty: false, trackingStatus: "moving", speedMps: 8 }),
        filters({ statusChips: ["online"] }),
        meta,
        zoneShapes,
        NOW,
      ),
      false,
    );
  });

  it("shows an on-duty driver when only On duty is selected", () => {
    assert.equal(
      matchesLiveTrackingFilters(
        loc({ isOnDuty: true, trackingStatus: "idle", speedMps: 0 }),
        filters({ statusChips: ["on_duty"] }),
        meta,
        zoneShapes,
        NOW,
      ),
      true,
    );
  });

  it("hides a logged-out driver when only On duty is selected", () => {
    assert.equal(
      matchesLiveTrackingFilters(
        loc({ isOnDuty: false, trackingStatus: "idle" }),
        filters({ statusChips: ["on_duty"] }),
        meta,
        zoneShapes,
        NOW,
      ),
      false,
    );
  });

  it("hides a stale-GPS on-duty driver when only Online is selected", () => {
    const stale = new Date(NOW - 10 * 60 * 1000).toISOString();
    assert.equal(
      matchesLiveTrackingFilters(
        loc({ isOnDuty: true, lastSeenAt: stale, trackingStatus: "idle" }),
        filters({ statusChips: ["online"] }),
        meta,
        zoneShapes,
        NOW,
      ),
      false,
    );
  });

  it("shows a stale-GPS on-duty driver when only On duty is selected", () => {
    const stale = new Date(NOW - 10 * 60 * 1000).toISOString();
    assert.equal(
      matchesLiveTrackingFilters(
        loc({ isOnDuty: true, lastSeenAt: stale, trackingStatus: "idle" }),
        filters({ statusChips: ["on_duty"] }),
        meta,
        zoneShapes,
        NOW,
      ),
      true,
    );
  });
});

describe("matchesLiveTrackingFilters offline chip", () => {
  it("shows logged-out drivers when every status chip is selected", () => {
    assert.equal(
      matchesLiveTrackingFilters(
        loc({ isOnDuty: false, trackingStatus: "moving", speedMps: 8 }),
        filters(),
        { zoneId: null, partnerId: null, zoneName: null },
        zoneShapes,
      ),
      true,
    );
  });

  it("does not treat a logged-out driver as Idle", () => {
    assert.equal(
      matchesLiveTrackingFilters(
        loc({ isOnDuty: false, trackingStatus: "idle" }),
        filters({ statusChips: ["idle"] }),
        { zoneId: null, partnerId: null, zoneName: null },
        zoneShapes,
      ),
      false,
    );
  });

  it("does not treat GPS-lost or blocked drivers as Idle", () => {
    const stale = new Date(Date.now() - 9 * 60_000).toISOString();
    assert.equal(
      matchesLiveTrackingFilters(
        loc({ lastSeenAt: stale, trackingStatus: "idle" }),
        filters({ statusChips: ["idle"] }),
        { zoneId: null, partnerId: null, zoneName: null },
        zoneShapes,
      ),
      false,
    );
    assert.equal(
      matchesLiveTrackingFilters(
        loc({ isBlocked: true, trackingStatus: "moving", speedMps: 8 }),
        filters({ statusChips: ["idle"] }),
        { zoneId: null, partnerId: null, zoneName: null },
        zoneShapes,
      ),
      false,
    );
    assert.equal(
      matchesLiveTrackingFilters(
        loc({ isBlocked: true, trackingStatus: "moving", speedMps: 8 }),
        filters({ statusChips: ["offline"] }),
        { zoneId: null, partnerId: null, zoneName: null },
        zoneShapes,
      ),
      true,
    );
  });
});

describe("matchesLiveTrackingFilters vehicle type", () => {
  const meta = { zoneId: null, partnerId: null, zoneName: null };
  it("narrows to car and treats a missing type as bike", () => {
    assert.equal(
      matchesLiveTrackingFilters(
        loc({ vehicleType: "car" }),
        filters({ vehicleType: "car" }),
        meta,
        zoneShapes,
        NOW,
      ),
      true,
    );
    assert.equal(
      matchesLiveTrackingFilters(
        loc({ vehicleType: "bike" }),
        filters({ vehicleType: "car" }),
        meta,
        zoneShapes,
        NOW,
      ),
      false,
    );
    assert.equal(
      matchesLiveTrackingFilters(loc(), filters({ vehicleType: "bike" }), meta, zoneShapes, NOW),
      true,
    );
  });
});

describe("resetLiveTrackingFilters", () => {
  it("clears search, zone, partner, battery, gps, and restores every status chip", () => {
    const dirty: LiveTrackingFilterState = {
      search: "ali",
      zoneId: "zone-kuwait",
      partnerId: "partner-1",
      trackingStatus: "idle",
      onDutyOnly: true,
      statusChips: ["idle"],
      batteryLevel: "low",
      gpsSignal: "weak",
      vehicleType: "car",
    };
    const reset = resetLiveTrackingFilters();
    assert.deepEqual(reset, DEFAULT_LIVE_TRACKING_FILTERS);
    assert.notEqual(reset.statusChips, dirty.statusChips);
    assert.notEqual(reset, dirty);
  });
});
