import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MENU_REGISTRY } from "./menu-registry";
import {
  everyRegistryIdHasTint,
  LAUNCHER_BRAND,
  LAUNCHER_TILE_HEX,
  launcherTileHex,
  moduleTint,
} from "./module-colors";
import { LAUNCHER_TILE_IDS } from "./launcher-modules";

describe("moduleTint", () => {
  it("gives every registry leaf a colour", () => {
    assert.equal(
      everyRegistryIdHasTint(MENU_REGISTRY.map((item) => item.id)),
      true,
    );
  });

  it("keeps the sidebar chip palette on EmployeeDesk red", () => {
    assert.equal(moduleTint("employeedesk").tile, "#E11D48");
  });

  it("matches the Figma launcher canvas and chrome", () => {
    assert.equal(LAUNCHER_BRAND.canvas, "#212134");
    assert.equal(LAUNCHER_BRAND.topBar, "#28283E");
    assert.equal(LAUNCHER_BRAND.logoChip, "#D9D2CF");
    assert.equal(LAUNCHER_BRAND.badge, "#F03838");
    assert.equal(LAUNCHER_BRAND.muted, "#80808F");
  });

  it("gives every launcher tile its own Figma fill", () => {
    for (const id of LAUNCHER_TILE_IDS) {
      assert.equal(launcherTileHex(id), LAUNCHER_TILE_HEX[id], id);
    }
    assert.equal(launcherTileHex("dashboard-ops"), "#544D99");
    assert.equal(launcherTileHex("drivers"), "#C27047");
    assert.equal(launcherTileHex("deliveries"), "#478F75");
    assert.equal(launcherTileHex("employeedesk"), "#B8474D");
  });

  it("falls back to the brand teal for an unknown module", () => {
    assert.equal(launcherTileHex("not-a-module"), "#0F766E");
  });
});
