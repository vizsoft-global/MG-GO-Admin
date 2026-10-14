import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Permission } from "@/lib/auth/permissions";
import { LAUNCHER_GLYPH } from "./launcher-glyphs";
import {
  filterLauncherTiles,
  greetingBucket,
  LAUNCHER_LABEL_OVERRIDE,
  LAUNCHER_TILE_IDS,
  launcherRegistryItems,
  visibleLauncherTiles,
} from "./launcher-modules";

describe("launcher modules", () => {
  it("uses the artifact names on the launcher and keeps sidebar registry labels", () => {
    const items = launcherRegistryItems();
    assert.equal(items.find((item) => item.id === "drivers")?.defaultLabel, "Employees");
    assert.equal(items.find((item) => item.id === "employeedesk")?.defaultLabel, "EmployeeDesk");
    assert.equal(items.find((item) => item.id === "vehicles")?.defaultLabel, "Fleet Hub");
    assert.equal(items.find((item) => item.id === "visit-bookings")?.defaultLabel, "Visit Slots");
    assert.equal(LAUNCHER_LABEL_OVERRIDE.vehicles, "Vehicles");
    assert.equal(LAUNCHER_LABEL_OVERRIDE["visit-bookings"], "Visit Slots");
    assert.equal(LAUNCHER_LABEL_OVERRIDE.assets, "Assets");
    assert.equal(LAUNCHER_LABEL_OVERRIDE.payroll, "Payroll");
    assert.equal(items.find((item) => item.id === "visit-bookings")?.href, "/visit-bookings/slots");
    assert.equal(items.find((item) => item.id === "assets")?.href, "/assets");
    assert.equal(
      LAUNCHER_TILE_IDS[LAUNCHER_TILE_IDS.indexOf("assets") + 1],
      "profile",
    );
    assert.equal(LAUNCHER_TILE_IDS.includes("performance"), false);
    for (const id of LAUNCHER_TILE_IDS) {
      assert.ok(LAUNCHER_GLYPH[id]?.length, id);
    }
  });

  it("does not duplicate tile ids", () => {
    assert.equal(new Set(LAUNCHER_TILE_IDS).size, LAUNCHER_TILE_IDS.length);
    const items = launcherRegistryItems();
    assert.equal(items.length, LAUNCHER_TILE_IDS.length);
  });

  it("hides a tile the session cannot open", () => {
    const perms = new Set<Permission>(["dashboard.view"]);
    const tiles = visibleLauncherTiles(perms, false);
    assert.ok(tiles.some((item) => item.id === "dashboard-ops"));
    assert.ok(!tiles.some((item) => item.id === "employeedesk"));
  });

  it("keeps the Settings door and drops tiles that already live in a hub", () => {
    const tiles = visibleLauncherTiles(new Set(), true);
    assert.ok(tiles.some((item) => item.id === "profile"));
    assert.ok(tiles.some((item) => item.id === "operations-hub"));
    assert.ok(tiles.some((item) => item.id === "assets"));
    assert.ok(!tiles.some((item) => item.id === "performance"));
    for (const id of ["restaurants", "roles", "document-expiry", "driver-app"]) {
      assert.ok(!tiles.some((item) => item.id === id), id);
    }
  });

  it("filters by English and Arabic labels", () => {
    const items = launcherRegistryItems();
    const labels = new Map([
      ["employeedesk", "EmployeeDesk"],
      ["drivers", "الموظفون"],
    ]);
    assert.equal(filterLauncherTiles(items, "employeedesk", labels).map((i) => i.id).join(), "employeedesk");
    assert.equal(filterLauncherTiles(items, "الموظف", labels).map((i) => i.id).join(), "drivers");
  });

  it("splits the Kuwait day into greeting buckets", () => {
    assert.equal(greetingBucket(8), "morning");
    assert.equal(greetingBucket(14), "afternoon");
    assert.equal(greetingBucket(20), "evening");
  });
});
