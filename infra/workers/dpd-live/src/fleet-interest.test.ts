import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  matchesLiveViewport,
  matchesRosterFilters,
  type InterestSubject,
} from "./fleet-interest";
import { emptyView } from "../../../../src/features/live-tracking-v2/fleet-wire";

const KUWAIT: InterestSubject = {
  driverId: "d-in",
  status: "moving",
  lat: 29.37,
  lng: 47.98,
  zoneId: "z1",
  currentZoneId: "z1",
  partnerId: "p1",
  searchHaystack: "in rider 10001 kuwait city moving",
};

const OUT_OF_ZONE: InterestSubject = {
  driverId: "d-out",
  status: "idle",
  lat: 29.9,
  lng: 48.4,
  zoneId: "z1",
  currentZoneId: null,
  partnerId: "p1",
  searchHaystack: "out rider 10002 out of zone out_of_zone idle",
};

const ELSEWHERE: InterestSubject = {
  driverId: "d-else",
  status: "moving",
  lat: 28.0,
  lng: 46.0,
  zoneId: "z2",
  currentZoneId: "z2",
  partnerId: "p1",
  searchHaystack: "other rider 10003 moving",
};

const DOWNTOWN_BBOX: [number, number, number, number] = [47.8, 29.2, 48.1, 29.5];

describe("matchesRosterFilters", () => {
  it("keeps an out-of-zone driver who is outside the map frame", () => {
    const view = {
      ...emptyView(),
      bbox: DOWNTOWN_BBOX,
    };
    assert.equal(matchesRosterFilters(OUT_OF_ZONE, view), true);
    assert.equal(matchesLiveViewport(OUT_OF_ZONE, view), false);
  });

  it("still honours a status chip on the roster", () => {
    const view = { ...emptyView(), statuses: ["moving" as const] };
    assert.equal(matchesRosterFilters(KUWAIT, view), true);
    assert.equal(matchesRosterFilters(OUT_OF_ZONE, view), false);
  });
});

describe("matchesLiveViewport", () => {
  it("streams a searched driver even when they are off the map", () => {
    const view = {
      ...emptyView(),
      bbox: DOWNTOWN_BBOX,
      search: "Out Rider",
    };
    assert.equal(matchesLiveViewport(OUT_OF_ZONE, view), true);
    assert.equal(matchesLiveViewport(ELSEWHERE, view), false);
  });

  it("keeps a pinned driver live off the map", () => {
    const view = {
      ...emptyView(),
      bbox: DOWNTOWN_BBOX,
      driverId: "d-out",
    };
    assert.equal(matchesLiveViewport(OUT_OF_ZONE, view), true);
  });
});
