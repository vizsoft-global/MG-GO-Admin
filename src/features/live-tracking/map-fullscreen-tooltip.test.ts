import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapFullscreenTooltipKey } from "./map-fullscreen-tooltip";

describe("mapFullscreenTooltipKey", () => {
  it("shows Exit fullscreen while map-only fullscreen is on", () => {
    assert.equal(mapFullscreenTooltipKey(true), "exitFullscreen");
  });

  it("shows Fullscreen when the map is in the normal stage", () => {
    assert.equal(mapFullscreenTooltipKey(false), "fullscreen");
  });
});
