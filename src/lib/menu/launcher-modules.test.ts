import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Permission } from "@/lib/auth/permissions";
import {
  filterLauncherTiles,
  greetingBucket,
  LAUNCHER_TILE_IDS,
  launcherRegistryItems,
  visibleLauncherTiles,
} from "./launcher-modules";

describe("launcher modules", () => {
  it("uses the approved client module names on the launcher tiles", () => {
    const items = launcherRegistryItems();
    assert.equal(items.find((item) => item.id === "drivers")?.defaultLabel, "Employees");
    assert.equal(items.find((item) => item.id === "employeedesk")?.defaultLabel, "EmployeeDesk");
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
