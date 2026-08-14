import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  debouncedMembership,
  haversineMeters,
  inBbox,
  parseZone,
  resolveZoneAt,
  zoneMembership,
  type WorkerZone,
} from "./geo";

/** A ~2.2km square around Kuwait City, in the GeoJSON Feature shape `zones` stores. */
const squareRow = {
  id: "zone-square",
  name: "Square",
  color: "#ff0000",
  zone_type: "polygon",
  geometry: {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [47.97, 29.36],
          [47.99, 29.36],
          [47.99, 29.38],
          [47.97, 29.38],
          [47.97, 29.36],
        ],
      ],
    },
  },
};

const circleRow = {
  id: "zone-circle",
  name: "Circle",
  color: "#00ff00",
  zone_type: "circle",
  geometry: {
    type: "Feature",
    properties: { radiusMeters: 500 },
    geometry: { type: "Point", coordinates: [47.98, 29.37] },
  },
};

function square(): WorkerZone {
  const zone = parseZone(squareRow);
  assert.ok(zone);
  return zone;
}

function circle(): WorkerZone {
  const zone = parseZone(circleRow);
  assert.ok(zone);
  return zone;
}

describe("haversineMeters", () => {
  it("measures a known short distance", () => {
    // 0.01 degrees of latitude is ~1111m anywhere on Earth.
    const d = haversineMeters(29.37, 47.98, 29.38, 47.98);
    assert.ok(Math.abs(d - 1111) < 5, `expected ~1111m, got ${d}`);
  });

  it("is zero for the same point", () => {
    assert.equal(haversineMeters(29.37, 47.98, 29.37, 47.98), 0);
  });
});

describe("parseZone", () => {
  it("builds a bbox for a polygon", () => {
    const zone = square();
    assert.equal(zone.zoneType, "polygon");
    assert.deepEqual(zone.bbox, [47.97, 29.36, 47.99, 29.38]);
  });

  it("derives a latitude-corrected bbox for a circle", () => {
    const zone = circle();
    assert.equal(zone.zoneType, "circle");
    const [west, south, east, north] = zone.bbox;
    assert.ok(west < 47.98 && east > 47.98);
    assert.ok(south < 29.37 && north > 29.37);
    // Longitude degrees are shorter than latitude degrees at this latitude, so the
    // box must be wider in longitude than in latitude.
    assert.ok(east - west > north - south);
  });

  it("rejects geometry it cannot use rather than guessing", () => {
    assert.equal(parseZone({ ...squareRow, geometry: null }), null);
    assert.equal(
      parseZone({ ...circleRow, geometry: { geometry: { type: "Point", coordinates: [47.98, 29.37] }, properties: {} } }),
      null,
      "a circle with no radius is not a zone",
    );
  });
});

describe("zoneMembership", () => {
  it("answers inside for an interior point and gives the distance to the edge", () => {
    const result = zoneMembership(29.37, 47.98, square());
    assert.equal(result.inside, true);
    // Centre of a ~2.2km x 1.9km box: nearest edge is roughly 950m away.
    assert.ok(result.distanceToEdgeM > 800 && result.distanceToEdgeM < 1200);
  });

  it("answers outside and still reports a positive distance", () => {
    const result = zoneMembership(29.40, 47.98, square());
    assert.equal(result.inside, false);
    assert.ok(result.distanceToEdgeM > 0);
  });

  it("handles circles by radius", () => {
    const inside = zoneMembership(29.3705, 47.98, circle());
    assert.equal(inside.inside, true);
    const outside = zoneMembership(29.38, 47.98, circle());
    assert.equal(outside.inside, false);
  });
});

describe("debouncedMembership", () => {
  const zone = square();
  const buffer = 25;

  it("takes the raw answer when there is no previous state", () => {
    assert.equal(debouncedMembership(29.37, 47.98, zone, null, buffer), true);
    assert.equal(debouncedMembership(29.40, 47.98, zone, null, buffer), false);
  });

  it("keeps the previous answer while the point straddles the boundary", () => {
    // ~5m outside the northern edge: a real crossing, but inside the buffer.
    const justOutside = 29.38 + 5 / 111_320;
    assert.equal(
      debouncedMembership(justOutside, 47.98, zone, true, buffer),
      true,
      "a driver 5m past the line stays inside until they are clear of the buffer",
    );
    assert.equal(debouncedMembership(justOutside, 47.98, zone, false, buffer), false);
  });

  it("accepts the change once the point is clear of the buffer", () => {
    const wellOutside = 29.38 + 60 / 111_320;
    assert.equal(debouncedMembership(wellOutside, 47.98, zone, true, buffer), false);
  });

  it("does not debounce when the answer has not changed", () => {
    const justInside = 29.38 - 5 / 111_320;
    assert.equal(debouncedMembership(justInside, 47.98, zone, true, buffer), true);
  });
});

describe("resolveZoneAt", () => {
  it("returns the containing zone", () => {
    const zones = [square(), circle()];
    assert.equal(resolveZoneAt(29.3705, 47.98, zones)?.id, "zone-square");
  });

  it("returns null outside every zone", () => {
    assert.equal(resolveZoneAt(30.5, 47.98, [square(), circle()]), null);
  });
});

describe("inBbox", () => {
  it("passes everything through when there is no viewport", () => {
    assert.equal(inBbox(29.37, 47.98, null), true);
  });

  it("filters by the viewport", () => {
    const bbox: [number, number, number, number] = [47.9, 29.3, 48.1, 29.5];
    assert.equal(inBbox(29.37, 47.98, bbox), true);
    assert.equal(inBbox(29.6, 47.98, bbox), false);
    assert.equal(inBbox(29.37, 48.5, bbox), false);
  });

  it("handles a viewport crossing the antimeridian", () => {
    const bbox: [number, number, number, number] = [170, -10, -170, 10];
    assert.equal(inBbox(0, 175, bbox), true);
    assert.equal(inBbox(0, -175, bbox), true);
    assert.equal(inBbox(0, 0, bbox), false);
  });
});
