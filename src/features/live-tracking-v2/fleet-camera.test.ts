import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FLEET_KEEP_IN_VIEW_PADDING,
  needsRecentre,
  pathBounds,
  type FleetBounds,
} from "./fleet-camera";

/** A 1° × 1° viewport around Kuwait City, so the padded inset is a round 0.2°. */
const VIEW: FleetBounds = { west: 47.5, south: 29.0, east: 48.5, north: 30.0 };

describe("needsRecentre", () => {
  it("leaves the camera alone for a rider comfortably on screen", () => {
    assert.equal(needsRecentre([48.0, 29.5], VIEW), false);
  });

  it("recentres once the rider reaches the padded edge", () => {
    // 0.2° of inset on a 1° viewport: 47.69 is inside the edge band, 47.75 is clear of it.
    assert.equal(needsRecentre([47.69, 29.5], VIEW), true);
    assert.equal(needsRecentre([47.75, 29.5], VIEW), false);
    assert.equal(needsRecentre([48.31, 29.5], VIEW), true);
    assert.equal(needsRecentre([48.0, 29.19], VIEW), true);
    assert.equal(needsRecentre([48.0, 29.81], VIEW), true);
  });

  it("recentres a rider outside the viewport entirely", () => {
    assert.equal(needsRecentre([46.0, 29.5], VIEW), true);
    assert.equal(needsRecentre([48.0, 31.0], VIEW), true);
  });

  it("honours a custom padding", () => {
    // With no padding only leaving the viewport counts.
    assert.equal(needsRecentre([47.51, 29.5], VIEW, 0), false);
    assert.equal(needsRecentre([47.49, 29.5], VIEW, 0), true);
    assert.ok(FLEET_KEEP_IN_VIEW_PADDING > 0);
  });

  it("recentres when the viewport has no area yet", () => {
    // A map that has not laid out reports a degenerate bounds; centring is the safe
    // answer, since the alternative is leaving the rider off-screen.
    assert.equal(
      needsRecentre([48.0, 29.5], { west: 48, south: 29.5, east: 48, north: 29.5 }),
      true,
    );
  });

  it("handles a viewport crossing the antimeridian", () => {
    const wrapped: FleetBounds = { west: 179.0, south: 29.0, east: -179.0, north: 30.0 };
    assert.equal(needsRecentre([180, 29.5], wrapped), false);
    assert.equal(needsRecentre([179.1, 29.5], wrapped), true);
  });

  it("ignores a position that is not a coordinate", () => {
    assert.equal(needsRecentre([Number.NaN, 29.5], VIEW), false);
  });
});

describe("pathBounds", () => {
  it("frames a path", () => {
    assert.deepEqual(
      pathBounds([
        [47.9, 29.3],
        [48.1, 29.4],
        [48.0, 29.2],
      ]),
      { west: 47.9, south: 29.2, east: 48.1, north: 29.4 },
    );
  });

  it("refuses a path with nothing to frame", () => {
    assert.equal(pathBounds([]), null);
    assert.equal(pathBounds([[47.9, 29.3]]), null);
    // A parked rider's route is many points at one place: fitting a zero-area bounds
    // snaps Google Maps to maximum zoom, so the caller centres instead.
    assert.equal(
      pathBounds([
        [47.9, 29.3],
        [47.9, 29.3],
      ]),
      null,
    );
  });
});
