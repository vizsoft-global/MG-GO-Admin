import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FleetTrailStore, fleetTrailColor, trailSpanMeters } from "./fleet-trail";
import { TRAIL_MIN_GAP_MS, TRAIL_WINDOW_MS, encodeTrailPoint } from "./fleet-wire";

const T0 = 1_700_000_000_000;
const LAT = 29.37;
const LNG = 47.98;

/** ~11m of latitude, which clears the 5m move gate. */
const STEP = 0.0001;

describe("FleetTrailStore", () => {
  it("has no trail for a driver it has never seen", () => {
    assert.equal(new FleetTrailStore().get("nobody"), null);
  });

  it("appends a point that has moved far enough", () => {
    const store = new FleetTrailStore();
    assert.equal(store.append("d1", LAT, LNG, T0), true);
    assert.equal(store.append("d1", LAT + STEP, LNG, T0 + 500), true);

    const trail = store.get("d1");
    assert.ok(trail);
    assert.deepEqual(trail.coords, [LNG, LAT, LNG, LAT + STEP]);
    assert.deepEqual(trail.ts, [T0, T0 + 500]);
  });

  it("drops a point that is neither far enough nor old enough", () => {
    const store = new FleetTrailStore();
    store.append("d1", LAT, LNG, T0);
    // A metre later, half a second later: invisible at any zoom, and at 1Hz this is
    // most of what a rider waiting at a light produces.
    assert.equal(store.append("d1", LAT + 0.000009, LNG, T0 + 500), false);
    assert.equal(store.get("d1")!.ts.length, 1);
  });

  it("keeps a stationary rider's point once the time gate passes", () => {
    const store = new FleetTrailStore();
    store.append("d1", LAT, LNG, T0);
    assert.equal(store.append("d1", LAT, LNG, T0 + TRAIL_MIN_GAP_MS), true);
    assert.equal(store.get("d1")!.ts.length, 2);
  });

  it("refuses a point older than the newest one", () => {
    const store = new FleetTrailStore();
    store.append("d1", LAT, LNG, T0 + 10_000);
    assert.equal(store.append("d1", LAT + STEP, LNG, T0), false);
    assert.equal(store.get("d1")!.ts.length, 1);
  });

  it("prunes points that fall out of the window", () => {
    const store = new FleetTrailStore();
    store.append("d1", LAT, LNG, T0);
    store.append("d1", LAT + STEP, LNG, T0 + TRAIL_WINDOW_MS / 2);
    // Appending well past the window must take the oldest point with it.
    store.append("d1", LAT + 2 * STEP, LNG, T0 + TRAIL_WINDOW_MS + 1_000);

    const trail = store.get("d1")!;
    assert.equal(trail.ts.length, 2);
    assert.equal(trail.ts[0], T0 + TRAIL_WINDOW_MS / 2);
    assert.equal(trail.coords.length, 4);
  });

  it("prunes a rider who stopped reporting, so a dead tail does not hang on the map", () => {
    const store = new FleetTrailStore();
    store.append("d1", LAT, LNG, T0);
    store.append("d1", LAT + STEP, LNG, T0 + 1_000);

    assert.equal(store.prune(T0 + TRAIL_WINDOW_MS + 5_000), true);
    assert.equal(store.get("d1")!.ts.length, 0);
  });

  it("hydrates from wire triplets, converting lat/lng order once", () => {
    const store = new FleetTrailStore();
    const pts = [
      ...encodeTrailPoint(LAT, LNG, T0),
      ...encodeTrailPoint(LAT + STEP, LNG + STEP, T0 + 1_000),
    ];
    store.hydrate("d1", pts, T0 + 2_000);

    const trail = store.get("d1")!;
    // Wire is lat-first; the buffer is lng-first for deck.gl.
    assert.equal(Math.round(trail.coords[0]! * 1e5), Math.round(LNG * 1e5));
    assert.equal(Math.round(trail.coords[1]! * 1e5), Math.round(LAT * 1e5));
    assert.equal(trail.ts.length, 2);
  });

  it("drops hydrated points already outside the window", () => {
    const store = new FleetTrailStore();
    const pts = [
      ...encodeTrailPoint(LAT, LNG, T0 - TRAIL_WINDOW_MS - 60_000),
      ...encodeTrailPoint(LAT + STEP, LNG, T0),
    ];
    store.hydrate("d1", pts, T0);
    assert.equal(store.get("d1")!.ts.length, 1);
  });

  it("replaces rather than merges on re-hydrate, so a re-sent trail cannot double", () => {
    const store = new FleetTrailStore();
    const pts = [
      ...encodeTrailPoint(LAT, LNG, T0),
      ...encodeTrailPoint(LAT + STEP, LNG, T0 + 1_000),
    ];
    store.hydrate("d1", pts, T0 + 2_000);
    store.hydrate("d1", pts, T0 + 2_000);
    assert.equal(store.get("d1")!.ts.length, 2);
  });

  it("bumps a revision the map can use as a deck.gl update trigger", () => {
    const store = new FleetTrailStore();
    const start = store.revision;
    store.append("d1", LAT, LNG, T0);
    assert.ok(store.revision > start);

    const afterAppend = store.revision;
    // A rejected point changes nothing, so it must not invalidate tesselation.
    store.append("d1", LAT, LNG, T0 + 1);
    assert.equal(store.revision, afterAppend);
  });

  it("gives a driver the same colour every time, and neighbours different ones", () => {
    const a = fleetTrailColor("driver-10088");
    assert.deepEqual(a, fleetTrailColor("driver-10088"));

    // Sequential driver codes are the realistic case, and the one a plain hash-to-hue
    // gets wrong by putting them all in the same part of the wheel.
    const codes = Array.from({ length: 12 }, (_, i) => `driver-100${80 + i}`);
    const colors = codes.map(fleetTrailColor);
    const unique = new Set(colors.map((c) => c.join(",")));
    assert.equal(unique.size, codes.length, "sequential ids must not collide");
  });

  it("forgets a driver on removal", () => {
    const store = new FleetTrailStore();
    store.append("d1", LAT, LNG, T0);
    store.remove("d1");
    assert.equal(store.get("d1"), null);
    assert.equal(store.size, 0);
  });
});

describe("trailSpanMeters", () => {
  it("measures a parked rider's jitter as a few metres, not a path", () => {
    const store = new FleetTrailStore();
    // Ten minutes of a stationary phone: the time gate keeps letting points through,
    // so the trail fills up without going anywhere. Drawn, this is a coloured blob on
    // the marker that reads as extra drivers of other statuses.
    for (let i = 0; i < 40; i += 1) {
      store.append(
        "d1",
        LAT + (i % 2 === 0 ? 0.00003 : -0.00003),
        LNG,
        T0 + i * TRAIL_MIN_GAP_MS,
      );
    }
    assert.ok(
      trailSpanMeters(store.get("d1")!) < 25,
      "jitter must fall under the map's draw threshold",
    );
  });

  it("measures a real ride in hundreds of metres", () => {
    const store = new FleetTrailStore();
    for (let i = 0; i < 20; i += 1) {
      store.append("d1", LAT + i * STEP, LNG, T0 + i * 1_000);
    }
    assert.ok(trailSpanMeters(store.get("d1")!) > 200);
  });

  it("re-measures only when the trail changed", () => {
    const store = new FleetTrailStore();
    store.append("d1", LAT, LNG, T0);
    store.append("d1", LAT + STEP, LNG, T0 + 1_000);
    const trail = store.get("d1")!;

    const first = trailSpanMeters(trail);
    assert.equal(trail.spanRev, trail.revision);
    assert.equal(trailSpanMeters(trail), first);

    store.append("d1", LAT + STEP * 20, LNG, T0 + 2_000);
    assert.ok(trailSpanMeters(trail) > first, "an appended point re-measures the span");
  });

  it("is zero for a single point, which has no extent", () => {
    const store = new FleetTrailStore();
    store.append("d1", LAT, LNG, T0);
    assert.equal(trailSpanMeters(store.get("d1")!), 0);
  });
});
