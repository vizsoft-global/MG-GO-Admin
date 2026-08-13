import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  heatmapLayerDataFromPoints,
  isHeatmapLayerEnabled,
} from "./tracking-map-layer-controller";

describe("heatmap layer", () => {
  it("is enabled only for the heatmap toolbar pill", () => {
    assert.equal(isHeatmapLayerEnabled("heatmap"), true);
    assert.equal(isHeatmapLayerEnabled("live"), false);
  });

  it("builds WeightedLocation points with LatLng instances, not literals", () => {
    class FakeLatLng {
      constructor(
        readonly latValue: number,
        readonly lngValue: number,
      ) {}
    }
    const data = heatmapLayerDataFromPoints(
      [{ lat: 12.95, lng: 80.23, weight: 2 }],
      FakeLatLng as unknown as new (lat: number, lng: number) => FakeLatLng,
    );
    assert.equal(data.length, 1);
    assert.ok(data[0].location instanceof FakeLatLng);
    assert.equal(data[0].weight, 2);
  });
});
