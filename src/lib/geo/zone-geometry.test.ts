import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCircleFeature,
  buildPolygonFeature,
  isPointInZone,
  validateZoneGeometry,
} from "./zone-geometry";

describe("isPointInZone", () => {
  const kuwaitSquare = buildPolygonFeature([
    [29.3, 47.9],
    [29.3, 48.0],
    [29.4, 48.0],
    [29.4, 47.9],
  ]);

  it("returns true for point inside polygon", () => {
    assert.equal(
      isPointInZone(29.35, 47.95, { zone_type: "polygon", geometry: kuwaitSquare }),
      true,
    );
  });

  it("returns false for point outside polygon", () => {
    assert.equal(
      isPointInZone(29.5, 48.1, { zone_type: "polygon", geometry: kuwaitSquare }),
      false,
    );
  });

  it("returns true for point inside circle", () => {
    const circle = buildCircleFeature([29.37, 47.97], 2000);
    assert.equal(
      isPointInZone(29.37, 47.97, { zone_type: "circle", geometry: circle }),
      true,
    );
  });

  it("returns false for point outside circle", () => {
    const circle = buildCircleFeature([29.37, 47.97], 500);
    assert.equal(
      isPointInZone(29.4, 48.0, { zone_type: "circle", geometry: circle }),
      false,
    );
  });
});

describe("validateZoneGeometry", () => {
  it("rejects circle with invalid radius", () => {
    const circle = buildCircleFeature([29.37, 47.97], 10);
    assert.equal(validateZoneGeometry("circle", circle), "invalid_radius");
  });

  it("accepts valid polygon", () => {
    const poly = buildPolygonFeature([
      [29.3, 47.9],
      [29.3, 48.0],
      [29.4, 48.0],
    ]);
    assert.equal(validateZoneGeometry("polygon", poly), null);
  });
});
