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

  it("matches the brand canvas chrome", () => {
    assert.equal(LAUNCHER_BRAND.canvas, "#2b2b48");
    assert.equal(LAUNCHER_BRAND.topBar, "#383855");
    assert.equal(LAUNCHER_BRAND.logoChip, "#d9d2cf");
    assert.equal(LAUNCHER_BRAND.badge, "#e23d3d");
    assert.equal(LAUNCHER_BRAND.badgeBorder, "#2b2b48");
    assert.equal(LAUNCHER_BRAND.tile, "#d9d2cf");
    assert.equal(LAUNCHER_BRAND.footerBar, "#353555");
    assert.equal(LAUNCHER_BRAND.accent, "#d25335");
  });

  it("gives every launcher tile its own artifact fill", () => {
    for (const id of LAUNCHER_TILE_IDS) {
      assert.equal(launcherTileHex(id), LAUNCHER_TILE_HEX[id], id);
    }
    assert.equal(launcherTileHex("dashboard-ops"), "#4b4b80");
    assert.equal(launcherTileHex("drivers"), "#b5643f");
    assert.equal(launcherTileHex("deliveries"), "#557f6a");
    assert.equal(launcherTileHex("employeedesk"), "#a73d24");
  });

  it("falls back to the brand teal for an unknown module", () => {
    assert.equal(launcherTileHex("not-a-module"), "#0F766E");
  });
});
