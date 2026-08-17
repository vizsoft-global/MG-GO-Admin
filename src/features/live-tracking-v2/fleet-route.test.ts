import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  routeGeometryPositions,
  splitRouteGeometry,
  type FleetRoutePoint,
} from "./fleet-route";

function point(lng: number, lat: number, gapBefore = false): FleetRoutePoint {
  return { longitude: lng, latitude: lat, gap_before: gapBefore };
}

describe("splitRouteGeometry", () => {
  it("has no geometry for an empty day", () => {
    assert.equal(splitRouteGeometry([]), null);
  });

  it("keeps an uninterrupted day as one run", () => {
    const geometry = splitRouteGeometry([point(47.9, 29.3), point(47.91, 29.31)]);
    assert.deepEqual(geometry, {
      segments: [
        [
          [47.9, 29.3],
          [47.91, 29.31],
        ],
      ],
      gaps: [],
    });
  });

  it("cuts the run at a jump and connects its two ends", () => {
    const geometry = splitRouteGeometry([
      point(47.9, 29.3),
      point(47.91, 29.31),
      point(48.5, 29.9, true),
      point(48.51, 29.91),
    ]);

    assert.deepEqual(geometry?.segments, [
      [
        [47.9, 29.3],
        [47.91, 29.31],
      ],
      [
        [48.5, 29.9],
        [48.51, 29.91],
      ],
    ]);
    // The connector spans the hole itself, so the operator sees where the trace
    // stopped being a record of travel rather than a route simply restarting.
    assert.deepEqual(geometry?.gaps, [
      [
        [47.91, 29.31],
        [48.5, 29.9],
      ],
    ]);
  });

  it("drops a one-point run but keeps the gaps either side of it", () => {
    const geometry = splitRouteGeometry([
      point(47.9, 29.3),
      point(48.5, 29.9, true),
      point(47.91, 29.31, true),
      point(47.92, 29.32),
    ]);

    assert.deepEqual(geometry?.segments, [
      [
        [47.91, 29.31],
        [47.92, 29.32],
      ],
    ]);
    assert.equal(geometry?.gaps.length, 2);
    assert.deepEqual(geometry?.gaps[1], [
      [48.5, 29.9],
      [47.91, 29.31],
    ]);
  });

  it("ignores a jump flag on the first point, which has nothing before it", () => {
    const geometry = splitRouteGeometry([point(47.9, 29.3, true), point(47.91, 29.31)]);
    assert.deepEqual(geometry?.gaps, []);
    assert.equal(geometry?.segments.length, 1);
  });

  it("yields a gap-only geometry when every fix jumps", () => {
    const geometry = splitRouteGeometry([
      point(47.9, 29.3),
      point(48.5, 29.9, true),
      point(47.0, 28.5, true),
    ]);
    assert.deepEqual(geometry?.segments, []);
    assert.equal(geometry?.gaps.length, 2);
  });

  it("frames the camera over gap endpoints too", () => {
    const geometry = splitRouteGeometry([
      point(47.9, 29.3),
      point(48.5, 29.9, true),
      point(48.51, 29.91),
    ]);
    const positions = routeGeometryPositions(geometry);

    assert.ok(positions.some(([lng, lat]) => lng === 48.5 && lat === 29.9));
    assert.deepEqual(routeGeometryPositions(null), []);
  });
});
