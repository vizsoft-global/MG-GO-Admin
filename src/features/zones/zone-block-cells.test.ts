import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gridDisk } from "h3-js";
import {
  H3_BLOCK_RESOLUTIONS,
  indexForLatLng,
  unionCellsToPolygon,
} from "@/lib/geo/h3-blocks";
import type { ZoneGeoFeature } from "@/lib/geo/zone-geometry";
import {
  cellsForZone,
  MIN_ZONE_BLOCK_HEX_PX,
  zoneBlockSize,
  zoneBlocksVisible,
} from "./zone-block-cells";

/** Kuwait City, well inside the land mask. */
const LAT = 29.3759;
const LNG = 47.9774;

function paintedZone(size: "S" | "M" | "L", rings: number): {
  cells: string[];
  zone: ZoneGeoFeature;
} {
  const resolution = H3_BLOCK_RESOLUTIONS[size];
  const cells = gridDisk(indexForLatLng(LAT, LNG, resolution), rings);
  const unioned = unionCellsToPolygon(cells);
  assert.ok(unioned.ok, "the painted cells should union into one polygon");
  return {
    cells,
    zone: {
      ...unioned.feature,
      properties: { ...unioned.feature.properties, blockSize: size },
    },
  };
}

describe("zone block cells", () => {
  it("recovers exactly the cells a zone was painted from", () => {
    // This is what lets a saved zone redraw its honeycomb without storing the
    // cells: the union polygon plus the size is enough to reconstruct them.
    for (const size of ["S", "M", "L"] as const) {
      const { cells, zone } = paintedZone(size, 2);
      const recovered = cellsForZone(zone);
      assert.deepEqual(
        new Set(recovered),
        new Set(cells),
        `${size} blocks should round-trip through the union polygon`,
      );
    }
  });

  it("returns nothing for a zone that was drawn by hand", () => {
    const { zone } = paintedZone("M", 1);
    const handDrawn: ZoneGeoFeature = { ...zone, properties: {} };
    assert.equal(zoneBlockSize(handDrawn), null);
    assert.deepEqual(cellsForZone(handDrawn), []);
  });

  it("ignores a block size that is not a real size", () => {
    const { zone } = paintedZone("M", 1);
    const bogus = {
      ...zone,
      properties: { blockSize: "XL" },
    } as unknown as ZoneGeoFeature;
    assert.equal(zoneBlockSize(bogus), null);
    assert.deepEqual(cellsForZone(bogus), []);
  });

  it("returns nothing for a circle zone", () => {
    const circle: ZoneGeoFeature = {
      type: "Feature",
      properties: { radiusMeters: 500, blockSize: "M" },
      geometry: { type: "Point", coordinates: [LNG, LAT] },
    };
    assert.deepEqual(cellsForZone(circle), []);
  });

  it("hides the honeycomb once hexes shrink below legibility", () => {
    // Zoomed in far enough that even the smallest blocks are readable...
    assert.equal(zoneBlocksVisible("S", LAT, 16), true);
    // ...and zoomed out to the whole country, where they would be a smudge.
    assert.equal(zoneBlocksVisible("S", LAT, 8), false);
    assert.ok(MIN_ZONE_BLOCK_HEX_PX > 0);
  });

  it("caches by geometry identity", () => {
    const { zone } = paintedZone("M", 1);
    assert.equal(cellsForZone(zone), cellsForZone(zone));
  });
});
