import { describe, it } from "node:test";
import assert from "node:assert/strict";
import kinks from "@turf/kinks";
import { gridDisk, latLngToCell } from "h3-js";
import type { Feature, Polygon } from "geojson";
import {
  H3_BLOCK_RESOLUTIONS,
  H3_VIEWPORT_CELL_CAP,
  centerDiskCells,
  hexCellsForMapView,
  indexForLatLng,
  unionCellsToPolygon,
} from "./h3-blocks";

const KUWAIT_LAT = 29.3759;
const KUWAIT_LNG = 47.9774;
const RES_M = H3_BLOCK_RESOLUTIONS.M;

describe("h3-blocks", () => {
  it("maps lat/lng to the expected H3 index at res 9", () => {
    const expected = latLngToCell(KUWAIT_LAT, KUWAIT_LNG, RES_M);
    assert.equal(indexForLatLng(KUWAIT_LAT, KUWAIT_LNG, RES_M), expected);
    assert.match(expected, /^[0-9a-f]+$/i);
  });

  it("unions two adjacent hexes into a valid Polygon without kinks", () => {
    const origin = latLngToCell(KUWAIT_LAT, KUWAIT_LNG, RES_M);
    const disk = gridDisk(origin, 1).filter((c) => c !== origin);
    assert.ok(disk.length >= 1);
    const neighbor = disk[0];
    const result = unionCellsToPolygon([origin, neighbor]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.feature.geometry.type, "Polygon");
    const ring = result.feature.geometry.coordinates[0];
    assert.ok(ring.length >= 4);
    const first = ring[0];
    const last = ring[ring.length - 1];
    assert.equal(first[0], last[0]);
    assert.equal(first[1], last[1]);
    assert.equal(kinks(result.feature as Feature<Polygon>).features.length, 0);
  });

  it("rejects a non-adjacent set as disconnected", () => {
    const origin = latLngToCell(KUWAIT_LAT, KUWAIT_LNG, RES_M);
    const far = latLngToCell(KUWAIT_LAT + 0.08, KUWAIT_LNG + 0.08, RES_M);
    assert.notEqual(origin, far);
    const result = unionCellsToPolygon([origin, far]);
    assert.deepEqual(result, { ok: false, reason: "disconnected" });
  });

  it("always returns honeycomb cells for a city-scale view", () => {
    const disk = centerDiskCells(KUWAIT_LAT, KUWAIT_LNG, RES_M);
    assert.ok(disk.length > 1);
    assert.ok(disk.length <= H3_VIEWPORT_CELL_CAP);

    const wide = hexCellsForMapView({
      west: 47.5,
      south: 28.9,
      east: 48.4,
      north: 29.6,
      lat: KUWAIT_LAT,
      lng: KUWAIT_LNG,
      resolution: RES_M,
    });
    assert.equal(wide.fullViewport, false);
    assert.ok(wide.cells.length > 1);
    assert.ok(wide.cells.length <= H3_VIEWPORT_CELL_CAP);

    const tight = hexCellsForMapView({
      west: KUWAIT_LNG - 0.005,
      south: KUWAIT_LAT - 0.005,
      east: KUWAIT_LNG + 0.005,
      north: KUWAIT_LAT + 0.005,
      lat: KUWAIT_LAT,
      lng: KUWAIT_LNG,
      resolution: RES_M,
    });
    assert.equal(tight.fullViewport, true);
    assert.ok(tight.cells.length >= 1);
  });

  it("keeps selected cells when the city-scale view is capped", () => {
    const selected = latLngToCell(KUWAIT_LAT + 0.12, KUWAIT_LNG + 0.12, RES_M);
    const wide = hexCellsForMapView({
      west: 47.5,
      south: 28.9,
      east: 48.4,
      north: 29.6,
      lat: KUWAIT_LAT,
      lng: KUWAIT_LNG,
      resolution: RES_M,
      extraCells: [selected],
    });
    assert.equal(wide.fullViewport, false);
    assert.ok(wide.cells.includes(selected));
  });
});
