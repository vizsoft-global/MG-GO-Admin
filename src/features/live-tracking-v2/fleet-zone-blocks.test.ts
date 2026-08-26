import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gridDisk } from "h3-js";
import {
  H3_BLOCK_RESOLUTIONS,
  indexForLatLng,
  unionCellsToPolygon,
} from "@/lib/geo/h3-blocks";
import type { FleetZone } from "./fleet-types";
import { fleetZoneBlockOutlines } from "./fleet-zone-blocks";

const LAT = 29.3759;
const LNG = 47.9774;

const RED: [number, number, number] = [225, 29, 72];
const toRgb = () => RED;

function paintedZone(
  id: string,
  size: "S" | "M" | "L",
  rings: number,
): { zone: FleetZone; cellCount: number } {
  const cells = gridDisk(indexForLatLng(LAT, LNG, H3_BLOCK_RESOLUTIONS[size]), rings);
  const unioned = unionCellsToPolygon(cells);
  assert.ok(unioned.ok, "painted cells should union into one polygon");
  const ring = unioned.feature.geometry.coordinates[0] as [number, number][];
  return {
    cellCount: cells.length,
    zone: {
      id,
      name: id,
      color: "#e11d48",
      zoneType: "polygon",
      ring,
      center: null,
      radiusMeters: 0,
      blockSize: size,
    },
  };
}

describe("fleet zone block outlines", () => {
  it("rebuilds one outline per painted block", () => {
    const { zone, cellCount } = paintedZone("z1", "M", 2);
    const groups = fleetZoneBlockOutlines([zone], toRgb);

    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.size, "M");
    assert.equal(groups[0]!.data.length, cellCount);
  });

  it("emits [lng, lat] rings, which is the order deck.gl reads", () => {
    // h3-js hands back [lat, lng]; getting this backwards puts every zone in the
    // sea off Somalia, which renders without error and is why it needs pinning.
    const { zone } = paintedZone("z1", "M", 1);
    const [first] = fleetZoneBlockOutlines([zone], toRgb)[0]!.data;
    for (const [lng, lat] of first!.polygon) {
      assert.ok(Math.abs(lng - LNG) < 0.5, `lng ${lng} should sit near Kuwait`);
      assert.ok(Math.abs(lat - LAT) < 0.5, `lat ${lat} should sit near Kuwait`);
    }
  });

  it("skips a hand-drawn zone rather than tiling it with a grid nobody chose", () => {
    const { zone } = paintedZone("z1", "M", 1);
    assert.deepEqual(
      fleetZoneBlockOutlines([{ ...zone, blockSize: null }], toRgb),
      [],
    );
    assert.deepEqual(
      fleetZoneBlockOutlines(
        [{ ...zone, blockSize: "XL" as unknown as "M" }],
        toRgb,
      ),
      [],
    );
  });

  it("groups by size so each size can be gated at its own zoom", () => {
    const small = paintedZone("small", "S", 1).zone;
    const large = paintedZone("large", "L", 1).zone;
    const groups = fleetZoneBlockOutlines([small, large], toRgb);

    assert.equal(groups.length, 2);
    const bySize = new Map(groups.map((g) => [g.size, g]));
    // Smaller hexes need more zoom before they are worth drawing. Note the
    // labels run the other way from the cells: "L" is H3 resolution 10, whose
    // hexes are the *smallest* of the three.
    assert.ok(bySize.get("L")!.minZoom > bySize.get("S")!.minZoom);
  });

  it("takes the colour from the caller so outlines cannot drift from the fill", () => {
    const { zone } = paintedZone("z1", "M", 1);
    const groups = fleetZoneBlockOutlines([zone], () => [1, 2, 3]);
    assert.deepEqual(groups[0]!.data[0]!.rgb, [1, 2, 3]);
  });

  it("stops drawing once the shared cell budget runs out", () => {
    // Outlines are decoration; a runaway count would spend the frame budget the
    // drivers need. Many small zones share one ceiling.
    const zones: FleetZone[] = [];
    for (let i = 0; i < 60; i += 1) {
      zones.push({ ...paintedZone(`z${i}`, "S", 12).zone, id: `z${i}` });
    }
    const total = fleetZoneBlockOutlines(zones, toRgb).reduce(
      (sum, group) => sum + group.data.length,
      0,
    );
    assert.ok(total > 0, "it should still draw what fits");
    assert.ok(total <= 12_000, `budget exceeded: ${total}`);
  });
});
