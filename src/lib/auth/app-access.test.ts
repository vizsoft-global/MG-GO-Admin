import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APP_ACCESS_CATALOG,
  appAccessToTicks,
  catalogCoversLauncherTiles,
  copyAccess,
  diffAccess,
  modulesSelectedCount,
  ownedAccessSlugs,
  preservedUnknownSlugs,
  rcmSideSlugs,
  setAppLevel,
  slugsForLevel,
  ticksToAppAccess,
} from "./app-access";

describe("app access catalog", () => {
  it("covers every launcher tile", () => {
    assert.equal(catalogCoversLauncherTiles(), true);
    assert.equal(APP_ACCESS_CATALOG.length > 0, true);
  });
});

describe("level ↔ ticks", () => {
  it("round-trips none / viewer / user / manager for drivers", () => {
    for (const level of ["none", "viewer", "user", "manager"] as const) {
      const entry = APP_ACCESS_CATALOG.find((item) => item.appId === "drivers");
      assert.ok(entry);
      let state = ticksToAppAccess([]);
      state = setAppLevel(state, "drivers", level);
      const ticks = appAccessToTicks(state);
      const back = ticksToAppAccess(ticks);
      assert.equal(back.drivers.level, level, `level ${level} drifted`);
      assert.equal(back.drivers.custom, false, `level ${level} marked custom`);
    }
  });

  it("ticks bulk_delete only at Manager", () => {
    const entry = APP_ACCESS_CATALOG.find((item) => item.appId === "drivers");
    assert.ok(entry);
    const viewer = slugsForLevel(entry, "viewer");
    const user = slugsForLevel(entry, "user");
    const manager = slugsForLevel(entry, "manager");
    assert.equal(viewer.includes("drivers.bulk_delete"), false);
    assert.equal(user.includes("drivers.bulk_delete"), false);
    assert.equal(manager.includes("drivers.bulk_delete"), true);
    assert.equal(manager.includes("drivers.delete"), true);
    assert.equal(user.includes("drivers.create"), true);
    assert.equal(viewer.includes("drivers.create"), false);
  });

  it("preserves unknown slugs that no card owns", () => {
    const unknown = ["support.view", "wrong_actions.create", "made_up.slug"];
    let state = ticksToAppAccess(unknown);
    state = setAppLevel(state, "attendance", "viewer");
    const ticks = appAccessToTicks(state, preservedUnknownSlugs(unknown));
    assert.ok(ticks.includes("support.view"));
    assert.ok(ticks.includes("wrong_actions.create"));
    assert.ok(ticks.includes("made_up.slug"));
    assert.ok(ticks.includes("attendance.view"));
    assert.equal(ownedAccessSlugs().has("support.view"), false);
  });

  it("marks a delete-without-bulk_delete set as User + custom", () => {
    const back = ticksToAppAccess([
      "drivers.view",
      "drivers.create",
      "drivers.edit",
      "drivers.delete",
    ]);
    assert.equal(back.drivers.level, "user");
    assert.equal(back.drivers.custom, true);
  });
});

describe("RCM sides", () => {
  it("maps receiver and sender onto requests ticks", () => {
    let state = ticksToAppAccess([]);
    state = setAppLevel(state, "employeedesk", "user");
    assert.equal(state.employeedesk.receiver, true);
    assert.equal(state.employeedesk.sender, true);
    const ticks = appAccessToTicks(state);
    assert.ok(ticks.includes("requests.view"));
    assert.ok(ticks.includes("requests.approve"));
    assert.ok(ticks.includes("requests.create"));
    assert.ok(ticks.includes("requests.edit"));
    assert.equal(ticks.includes("requests.delete"), false);
    assert.ok(ticks.includes("employeedesk.view"));

    const managerSides = rcmSideSlugs("manager", { sender: true, receiver: true });
    assert.ok(managerSides.includes("requests.bulk_delete"));
  });

  it("round-trips a receiver-only viewer", () => {
    const ticks = ["requests.view", "requests.approve", "employeedesk.view"];
    const state = ticksToAppAccess(ticks);
    assert.equal(state.employeedesk.level, "viewer");
    assert.equal(state.employeedesk.receiver, true);
    assert.equal(state.employeedesk.sender, false);
    const out = appAccessToTicks(state);
    assert.ok(out.includes("requests.view"));
    assert.ok(out.includes("requests.approve"));
    assert.equal(out.includes("requests.create"), false);
  });
});

describe("diff and counts", () => {
  it("counts added / removed apps and level changes", () => {
    const before = ticksToAppAccess(["dashboard.view"]);
    let after = ticksToAppAccess(["dashboard.view", "drivers.view", "drivers.create", "drivers.edit"]);
    after = setAppLevel(after, "dashboard-ops", "none");
    const diff = diffAccess(before, after);
    assert.ok(diff.addedApps.includes("drivers"));
    assert.ok(diff.removedApps.includes("dashboard-ops"));
    assert.ok(diff.changeCount >= 2);
  });

  it("modulesSelectedCount ignores apps with no access", () => {
    assert.equal(modulesSelectedCount([]), 0);
    assert.equal(modulesSelectedCount(["dashboard.view", "assistant.view"]), 2);
  });

  it("copyAccess can keep the target sub-view choices", () => {
    const source = setAppLevel(ticksToAppAccess([]), "vehicles", "manager");
    source.vehicles.subViews = ["fuel"];
    const target = setAppLevel(ticksToAppAccess([]), "vehicles", "viewer");
    target.vehicles.subViews = ["fuelRequests"];
    const copied = copyAccess(source, target, true);
    assert.equal(copied.vehicles.level, "manager");
    assert.deepEqual(copied.vehicles.subViews, ["fuelRequests"]);
    const replaced = copyAccess(source, target, false);
    assert.deepEqual(replaced.vehicles.subViews, ["fuel"]);
  });
});
