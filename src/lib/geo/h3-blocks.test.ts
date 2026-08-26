import { describe, it } from "node:test";
import assert from "node:assert/strict";
import kinks from "@turf/kinks";
import { cellToBoundary, gridDisk, latLngToCell, polygonToCells } from "h3-js";
import type { Feature, Polygon } from "geojson";
import {
  H3_BLOCK_RESOLUTIONS,
  H3_SELECTION_CELL_CAP,
  H3_VIEWPORT_CELL_CAP,
  MIN_PAINTABLE_HEX_PX,
  MIN_VISIBLE_HEX_PX,
  hexGridForView,
  hexWidthPixels,
  indexForLatLng,
  isKuwaitLandCell,
  minZoomForHexPx,
  polygonToBlockCells,
  unionCellsToPolygon,
} from "./h3-blocks";

const KUWAIT_LAT = 29.3759;
const KUWAIT_LNG = 47.9774;
const RES_M = H3_BLOCK_RESOLUTIONS.M;

/** The zones map opens here — see features/zones/constants.ts. */
const DEFAULT_ZOOM = 12;
const PANE_WIDTH = 900;
const PANE_HEIGHT = 620;

/** Viewport a map of this size would show at a given centre and zoom. */
function viewAt(
  zoom: number,
  lat = KUWAIT_LAT,
  lng = KUWAIT_LNG,
  width = PANE_WIDTH,
  height = PANE_HEIGHT,
) {
  const metersPerPixel =
    (156_543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
  const dLat = ((height * metersPerPixel) / 2) / 110_574;
  const dLng =
    ((width * metersPerPixel) / 2) / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    west: lng - dLng,
    east: lng + dLng,
    south: lat - dLat,
    north: lat + dLat,
    zoom,
  };
}

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
    const result = unionCellsToPolygon([origin, disk[0]]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.feature.geometry.type, "Polygon");
    const ring = result.feature.geometry.coordinates[0];
    assert.ok(ring.length >= 4);
    assert.deepEqual(ring[0], ring[ring.length - 1]);
    assert.equal(kinks(result.feature as Feature<Polygon>).features.length, 0);
  });

  it("rejects a non-adjacent set as disconnected", () => {
    const origin = latLngToCell(KUWAIT_LAT, KUWAIT_LNG, RES_M);
    const far = latLngToCell(KUWAIT_LAT + 0.08, KUWAIT_LNG + 0.08, RES_M);
    assert.notEqual(origin, far);
    assert.deepEqual(unionCellsToPolygon([origin, far]), {
      ok: false,
      reason: "disconnected",
    });
  });

  // The bug this rewrite fixes: the grid used to vanish at the zoom the map
  // opens at, because a cell-count cap silently returned an empty honeycomb.
  it("draws a paintable honeycomb at the default map zoom for every block size", () => {
    for (const [size, resolution] of Object.entries(H3_BLOCK_RESOLUTIONS)) {
      const view = hexGridForView({ ...viewAt(DEFAULT_ZOOM), resolution });
      if (size === "L") continue; // finest size legitimately needs more zoom
      assert.equal(view.visible, true, `${size} should render at zoom ${DEFAULT_ZOOM}`);
      assert.equal(view.paintable, true, `${size} should be paintable`);
      assert.ok(view.cells.length > 100, `${size} drew only ${view.cells.length} hexes`);
      assert.ok(view.cells.length <= H3_VIEWPORT_CELL_CAP);
    }
  });

  it("keeps the honeycomb visible across every zoom the user can paint at", () => {
    for (const resolution of Object.values(H3_BLOCK_RESOLUTIONS)) {
      const firstPaintable = Math.ceil(
        minZoomForHexPx(resolution, KUWAIT_LAT, MIN_PAINTABLE_HEX_PX),
      );
      for (let zoom = firstPaintable; zoom <= firstPaintable + 4; zoom++) {
        const view = hexGridForView({ ...viewAt(zoom), resolution });
        assert.equal(view.visible, true, `res ${resolution} hidden at zoom ${zoom}`);
        assert.equal(view.paintable, true, `res ${resolution} unpaintable at zoom ${zoom}`);
        assert.ok(view.cells.length > 0, `res ${resolution} empty at zoom ${zoom}`);
      }
    }
  });

  // The cell cap is sized for the largest map anyone is likely to open; a
  // smaller one silently blanked the grid on wide monitors.
  it("still renders on a 2560x1440 map at the lowest paintable zoom", () => {
    for (const resolution of Object.values(H3_BLOCK_RESOLUTIONS)) {
      const zoom = Math.ceil(
        minZoomForHexPx(resolution, KUWAIT_LAT, MIN_PAINTABLE_HEX_PX),
      );
      const view = hexGridForView({
        ...viewAt(zoom, KUWAIT_LAT, KUWAIT_LNG, 2560, 1440),
        resolution,
      });
      assert.equal(view.visible, true, `res ${resolution} blanked at zoom ${zoom}`);
      assert.equal(view.paintable, true);
      assert.ok(
        view.cells.length <= H3_VIEWPORT_CELL_CAP,
        `res ${resolution} produced ${view.cells.length} cells`,
      );
    }
  });

  it("covers land and omits the Gulf", () => {
    const view = hexGridForView({ ...viewAt(13), resolution: RES_M });
    const city = latLngToCell(KUWAIT_LAT, KUWAIT_LNG, RES_M);
    const gulf = latLngToCell(29.42, 48.0, RES_M);
    assert.equal(isKuwaitLandCell(city), true);
    assert.equal(isKuwaitLandCell(gulf), false);
    assert.ok(view.cells.includes(city));
    assert.equal(view.cells.includes(gulf), false);
  });

  it("includes the offshore islands the old hand-drawn mask missed", () => {
    const failaka = latLngToCell(29.44, 48.33, RES_M);
    const bubiyan = latLngToCell(29.78, 48.3, RES_M);
    assert.equal(isKuwaitLandCell(failaka), true);
    assert.equal(isKuwaitLandCell(bubiyan), true);
    const view = hexGridForView({ ...viewAt(13, 29.44, 48.33), resolution: RES_M });
    assert.ok(view.cells.includes(failaka));
  });

  it("hides the grid when hexes shrink below the visibility floor, keeping the selection", () => {
    const selected = latLngToCell(KUWAIT_LAT, KUWAIT_LNG, RES_M);
    const zoom = 9;
    assert.ok(hexWidthPixels(RES_M, KUWAIT_LAT, zoom) < MIN_VISIBLE_HEX_PX);
    const view = hexGridForView({
      ...viewAt(zoom),
      resolution: RES_M,
      extraCells: [selected],
    });
    assert.equal(view.visible, false);
    assert.equal(view.paintable, false);
    assert.deepEqual(view.cells, [selected]);
  });

  it("never returns a sea cell, even one passed in as selected", () => {
    const gulf = latLngToCell(29.42, 48.0, RES_M);
    const view = hexGridForView({
      ...viewAt(13),
      resolution: RES_M,
      extraCells: [gulf],
    });
    assert.equal(view.cells.includes(gulf), false);
  });

  it("marks hexes unpaintable while still drawing them when they are small", () => {
    const zoom = Math.floor(
      minZoomForHexPx(RES_M, KUWAIT_LAT, MIN_PAINTABLE_HEX_PX),
    );
    const px = hexWidthPixels(RES_M, KUWAIT_LAT, zoom);
    assert.ok(px >= MIN_VISIBLE_HEX_PX && px < MIN_PAINTABLE_HEX_PX);
    const view = hexGridForView({ ...viewAt(zoom), resolution: RES_M });
    assert.equal(view.visible, true);
    assert.equal(view.paintable, false);
    assert.ok(view.cells.length > 0);
  });

  // Seeding a selection is bounded by what a paint gesture can re-union, not by
  // what the canvas can draw. Sharing the render cap here made entering Blocks
  // on a city-sized zone seed tens of thousands of cells, and every subsequent
  // click then re-unioned all of them.
  it("caps a seeded selection far below the render cap", () => {
    assert.ok(H3_SELECTION_CELL_CAP < H3_VIEWPORT_CELL_CAP / 10);

    const big: Feature<Polygon> = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [47.7, 29.2],
            [48.2, 29.2],
            [48.2, 29.55],
            [47.7, 29.55],
            [47.7, 29.2],
          ],
        ],
      },
    };
    assert.ok(
      polygonToCells(big.geometry.coordinates, RES_M, true).length >
        H3_SELECTION_CELL_CAP,
    );
    assert.deepEqual(polygonToBlockCells(big.geometry, RES_M), []);

    const boundary = cellToBoundary(
      indexForLatLng(KUWAIT_LAT, KUWAIT_LNG, RES_M),
      true,
    );
    const small: Polygon = {
      type: "Polygon",
      coordinates: [[...boundary, boundary[0]]],
    };
    assert.ok(polygonToBlockCells(small, RES_M).length > 0);
  });

  // The grid is built by walking a coarse land index instead of enumerating the
  // viewport; that shortcut must not change which hexes come out.
  it("matches an exhaustive viewport scan", () => {
    const bounds = viewAt(13);
    const view = hexGridForView({ ...bounds, resolution: RES_M });
    const ring = [
      [bounds.west, bounds.south],
      [bounds.east, bounds.south],
      [bounds.east, bounds.north],
      [bounds.west, bounds.north],
      [bounds.west, bounds.south],
    ];
    const exhaustive = polygonToCells([ring], RES_M, true).filter(isKuwaitLandCell);
    assert.deepEqual([...view.cells].sort(), [...exhaustive].sort());
  });
});
