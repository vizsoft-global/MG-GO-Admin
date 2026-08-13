import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPolygonFeature } from "@/lib/geo/zone-geometry";
import {
  DEFAULT_LIVE_TRACKING_FILTERS,
  matchesLiveTrackingFilters,
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
});
