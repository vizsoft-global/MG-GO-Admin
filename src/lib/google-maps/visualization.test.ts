import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachVisualizationNamespace, ensureVisualizationLibrary } from "./visualization";

describe("attachVisualizationNamespace", () => {
  it("attaches HeatmapLayer from importLibrary({ HeatmapLayer }) onto maps.visualization", () => {
    class HeatmapLayer {}
    const api = { maps: {} };
    assert.equal(attachVisualizationNamespace(api, { HeatmapLayer }), true);
    assert.equal(api.maps.visualization?.HeatmapLayer, HeatmapLayer);
  });

  it("keeps an existing HeatmapLayer when import result is empty", () => {
    class HeatmapLayer {}
    const api = { maps: { visualization: { HeatmapLayer } } };
    assert.equal(attachVisualizationNamespace(api, {}), true);
    assert.equal(api.maps.visualization?.HeatmapLayer, HeatmapLayer);
  });

  it("returns false when neither the import nor the api has HeatmapLayer", () => {
    const api = { maps: {} };
    assert.equal(attachVisualizationNamespace(api, {}), false);
    assert.equal(api.maps.visualization, undefined);
  });
});

describe("ensureVisualizationLibrary", () => {
  it("copies HeatmapLayer from importLibrary onto maps.visualization", async () => {
    class HeatmapLayer {}
    const api = {
      maps: {
        importLibrary: async () => ({ HeatmapLayer }),
      },
    };
    assert.equal(await ensureVisualizationLibrary(api), true);
    assert.equal(api.maps.visualization?.HeatmapLayer, HeatmapLayer);
  });
});
