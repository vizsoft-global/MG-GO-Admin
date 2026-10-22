import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Permission } from "@/lib/auth/permissions";
import { buildInitialTree } from "./menu-merge";
import { LAUNCHER_GLYPH } from "./launcher-glyphs";
import {
  filterLauncherTiles,
  greetingBucket,
  LAUNCHER_HIDDEN_TILE_IDS,
  LAUNCHER_LABEL_OVERRIDE,
  LAUNCHER_TILE_IDS,
  launcherRegistryItems,
  launcherTilesFromMenu,
  mergeLauncherTiles,
  visibleLauncherTiles,
  type LauncherTileId,
} from "./launcher-modules";

describe("launcher modules", () => {
  it("uses the artifact names on the launcher and keeps sidebar registry labels", () => {
    const items = launcherRegistryItems();
    assert.equal(items.find((item) => item.id === "drivers")?.defaultLabel, "Employees");
    assert.equal(items.find((item) => item.id === "employeedesk")?.defaultLabel, "EmployeeDesk");
    assert.equal(items.find((item) => item.id === "vehicles")?.defaultLabel, "Fleet Hub");
    assert.equal(items.find((item) => item.id === "visit-bookings")?.defaultLabel, "Visit Slots");
    assert.equal(LAUNCHER_LABEL_OVERRIDE.vehicles, undefined);
    assert.equal(LAUNCHER_LABEL_OVERRIDE["visit-bookings"], "Visit Slots");
    assert.equal(LAUNCHER_LABEL_OVERRIDE.assets, "Assets");
    assert.equal(LAUNCHER_LABEL_OVERRIDE.payroll, "Payroll");
    assert.equal(items.find((item) => item.id === "visit-bookings")?.href, "/visit-bookings");
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

  it("mirrors every sidebar row, so a hub the sidebar shows is a tile", () => {
    const tree = buildInitialTree(() => true, true);
    const derived = launcherTilesFromMenu(tree);
    const ids = derived.map((tile) => tile.id);

    assert.ok(ids.includes("vehicles"), "Fleet Hub");
    assert.ok(ids.includes("payroll-hub"), "Payroll Hub");
    assert.ok(!ids.includes("attendance"), "Attendance is an OperationsHub card");
    assert.ok(ids.includes("payroll"));
    assert.ok(!ids.includes("driver-groups"), "Driver groups is an OperationsHub card, not a row");
    assert.ok(!ids.includes("dashboard"), "the launcher is not its own tile");
    assert.equal(new Set(ids).size, ids.length);

    const settings = derived.filter((tile) => tile.href.startsWith("/settings"));
    assert.equal(
      settings.filter((tile) => tile.href === "/settings").length,
      1,
      "one Settings tile from the inline group",
    );
    assert.ok(derived.every((tile) => tile.href.startsWith("/")));
  });

  it("keeps launcher-only doors when merging with the curated list", () => {
    const derived = launcherTilesFromMenu(buildInitialTree(() => true, true));
    const merged = mergeLauncherTiles(derived, launcherRegistryItems());
    const ids = merged.map((tile) => tile.id);
    const hrefs = merged.map((tile) => tile.href);

    assert.ok(ids.includes("vehicles"));
    assert.ok(ids.includes("payroll-hub"));
    assert.ok(ids.includes("assistant"), "Staff Assistant is a launcher-only door");
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(new Set(hrefs).size, hrefs.length);
    assert.equal(hrefs.filter((href) => href === "/settings").length, 1);
  });

  it("drops Dashboard, Payroll, Earnings, Verification, Assets and Driver groups from the launcher only", () => {
    const derived = launcherTilesFromMenu(buildInitialTree(() => true, true));
    const merged = mergeLauncherTiles(derived, launcherRegistryItems());
    const ids = merged.map((tile) => tile.id);

    for (const hidden of LAUNCHER_HIDDEN_TILE_IDS) {
      assert.ok(!ids.includes(hidden), hidden);
    }
    assert.ok(ids.includes("payroll-hub"));

    for (const id of ["dpd-verification", "assets", "driver-groups"]) {
      assert.ok(LAUNCHER_HIDDEN_TILE_IDS.has(id), id);
      assert.ok(LAUNCHER_TILE_IDS.includes(id as LauncherTileId), `${id} keeps its tile slot`);
    }

    assert.ok(ids.includes("visit-bookings"), "Visit Slots stays a Home tile");
    assert.ok(!LAUNCHER_HIDDEN_TILE_IDS.has("visit-bookings"));

    const visible = visibleLauncherTiles(new Set(), true).map((tile) => tile.id);
    for (const hidden of LAUNCHER_HIDDEN_TILE_IDS) {
      assert.ok(visible.includes(hidden), `${hidden} keeps its permission surface`);
    }
  });

  it("splits the Kuwait day into greeting buckets", () => {    assert.equal(greetingBucket(8), "morning");
    assert.equal(greetingBucket(14), "afternoon");
    assert.equal(greetingBucket(20), "evening");
  });
});
