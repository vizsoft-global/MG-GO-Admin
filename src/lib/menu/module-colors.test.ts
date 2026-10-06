import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MENU_REGISTRY } from "./menu-registry";
import { everyRegistryIdHasTint, LAUNCHER_BRAND, LAUNCHER_BRAND_TINT, moduleTint } from "./module-colors";
import { LAUNCHER_TILE_IDS } from "./launcher-modules";

describe("moduleTint", () => {
  it("gives every registry leaf a colour", () => {
    assert.equal(
      everyRegistryIdHasTint(MENU_REGISTRY.map((item) => item.id)),
      true,
    );
  });

  it("keeps EmployeeDesk on the red chip outside the launcher", () => {
    assert.equal(moduleTint("employeedesk").tile, "#E11D48");
  });

  it("paints the home launcher the MG logo teal", () => {
    assert.equal(LAUNCHER_BRAND_TINT.tile, "#0F766E");
    assert.equal(LAUNCHER_BRAND_TINT.tile, moduleTint("dashboard").tile);
    assert.equal(LAUNCHER_BRAND.tile, "#0F766E");
    assert.equal(LAUNCHER_BRAND.icon, "#ECFDF5");
    assert.notEqual(LAUNCHER_BRAND.canvas, "#0B1220");
    assert.equal(LAUNCHER_BRAND.canvas, "#042F2E");
  });

  it("covers every launcher tile id", () => {
    for (const id of LAUNCHER_TILE_IDS) {
      assert.ok(moduleTint(id).chip);
    }
  });
});
