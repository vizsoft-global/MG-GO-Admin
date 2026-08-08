import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  shouldKeepPolygonDrawMode,
  shouldSwitchDrawToolToEdit,
  zoneDraftEnablesSave,
} from "./zone-draft-geometry";
import { buildPolygonFeature } from "@/lib/geo/zone-geometry";

describe("zone-draft-geometry", () => {
  it("Save enables once geometry has >= 3 vertices via provisional geometry, independent of activeTool/drawMode", () => {
    const feature = buildPolygonFeature([
      [29.3, 47.9],
      [29.4, 47.9],
      [29.4, 48.0],
    ]);
    assert.equal(zoneDraftEnablesSave(feature), true);
    assert.equal(zoneDraftEnablesSave(null), false);

    // Tool/drawMode must not gate Save — only geometry presence does.
    assert.equal(
      zoneDraftEnablesSave(feature) &&
        shouldKeepPolygonDrawMode({
          activeTool: "draw",
          hasGeometry: true,
          draftIsProvisional: true,
        }),
      true,
    );
    assert.equal(
      shouldSwitchDrawToolToEdit({ provisional: true }),
      false,
    );
  });

  it("final geometry switches to edit; provisional does not", () => {
    assert.equal(shouldSwitchDrawToolToEdit(undefined), true);
    assert.equal(shouldSwitchDrawToolToEdit({}), true);
    assert.equal(shouldSwitchDrawToolToEdit({ provisional: false }), true);
    assert.equal(shouldSwitchDrawToolToEdit({ provisional: true }), false);
  });

  it("keeps draw mode while provisional geometry exists", () => {
    assert.equal(
      shouldKeepPolygonDrawMode({
        activeTool: "draw",
        hasGeometry: true,
        draftIsProvisional: true,
      }),
      true,
    );
    assert.equal(
      shouldKeepPolygonDrawMode({
        activeTool: "draw",
        hasGeometry: true,
        draftIsProvisional: false,
      }),
      false,
    );
    assert.equal(
      shouldKeepPolygonDrawMode({
        activeTool: "draw",
        hasGeometry: false,
        draftIsProvisional: false,
      }),
      true,
    );
  });
});
