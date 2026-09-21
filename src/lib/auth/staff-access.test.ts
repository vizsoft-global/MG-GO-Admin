import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CATALOG_SLUGS, CATALOG_SLUG_SET } from "./permission-catalog";
import { hasPermissionInSet } from "./permissions";
import {
  expandRoleSlugsToUserTicks,
  isStaffMatrixSlug,
  managerDowngradeSeedTicks,
  migratedSessionIsSupersetOfRole,
  permissionGrantedByTicks,
  resolveSessionPermissionSlugs,
  roleSlugsForSave,
} from "./staff-access";

const OPERATOR_ROLE = [
  "dashboard.view",
  "drivers.view",
  "drivers.manage",
  "assets.view",
  "assets.manage",
  "deliveries.view",
  "performance.view",
  "performance.export",
  "settings.view",
  "users.manage",
] as const;

describe("staff access ticks", () => {
  it("expands CRUD manage into create/edit/delete and keeps extra verbs", () => {
    const ticks = expandRoleSlugsToUserTicks(OPERATOR_ROLE);
    assert.equal(ticks.has("drivers.manage"), false);
    assert.ok(ticks.has("drivers.create"));
    assert.ok(ticks.has("drivers.edit"));
    assert.ok(ticks.has("drivers.delete"));
    assert.ok(ticks.has("assets.create"));
    assert.ok(ticks.has("performance.export"));
    assert.ok(ticks.has("users.manage"));
    assert.ok(ticks.has("settings.view"));
  });

  it("migrated User session slugs are a superset of the old role slugs", () => {
    const ticks = expandRoleSlugsToUserTicks(OPERATOR_ROLE);
    assert.equal(migratedSessionIsSupersetOfRole(OPERATOR_ROLE, ticks), true);
    for (const slug of OPERATOR_ROLE) {
      assert.equal(
        permissionGrantedByTicks(ticks, slug),
        true,
        `lost access to ${slug}`,
      );
    }
  });

  it("fails the superset check when a migrated User is missing a role slug", () => {
    const ticks = expandRoleSlugsToUserTicks(OPERATOR_ROLE);
    ticks.delete("dashboard.view");
    assert.equal(migratedSessionIsSupersetOfRole(OPERATOR_ROLE, ticks), false);
  });

  it("Manager → User downgrade seeds the full catalog, not empty and not a role template", () => {
    const seeded = managerDowngradeSeedTicks(CATALOG_SLUGS);
    assert.ok(seeded.size > OPERATOR_ROLE.length);
    assert.ok(seeded.has("assistant.view"));
    assert.ok(seeded.has("assets.create"));
    assert.equal(seeded.has("assets.manage"), false);
    for (const slug of seeded) {
      assert.equal(isStaffMatrixSlug(slug), true);
      assert.ok(CATALOG_SLUG_SET.has(slug));
    }
  });

  it("role save writes manage back when any CRUD verb is ticked", () => {
    const saved = new Set(roleSlugsForSave(["assets.view", "assets.create"]));
    assert.ok(saved.has("assets.manage"));
    assert.ok(saved.has("assets.create"));
    assert.equal(saved.has("assets.delete"), false);
  });
});

describe("hasPermissionInSet manage alias", () => {
  it("lets a pre-migration manage slug unlock create/edit/delete", () => {
    const role = new Set(["assets.manage"]);
    assert.equal(hasPermissionInSet(role, "assets.create", false), true);
    assert.equal(hasPermissionInSet(role, "assets.edit", false), true);
    assert.equal(hasPermissionInSet(role, "assets.delete", false), true);
  });

  it("lets migrated create/edit/delete unlock manage, but not the missing verb", () => {
    const ticks = new Set(["assets.create"]);
    assert.equal(hasPermissionInSet(ticks, "assets.manage", false), true);
    assert.equal(hasPermissionInSet(ticks, "assets.create", false), true);
    assert.equal(hasPermissionInSet(ticks, "assets.delete", false), false);
  });
});

describe("resolveSessionPermissionSlugs", () => {
  it("uses role slugs before access_kind exists", () => {
    const slugs = resolveSessionPermissionSlugs({
      isSuperAdmin: false,
      accessKind: null,
      userTicks: null,
      roleSlugs: ["drivers.view"],
      catalogSlugs: CATALOG_SLUGS,
    });
    assert.deepEqual([...slugs], ["drivers.view"]);
  });

  it("gives Manager the full catalog", () => {
    const slugs = resolveSessionPermissionSlugs({
      isSuperAdmin: false,
      accessKind: "manager",
      userTicks: ["assets.view"],
      roleSlugs: ["drivers.view"],
      catalogSlugs: ["assets.view", "drivers.view"],
    });
    assert.equal(slugs.size, 2);
    assert.ok(slugs.has("assets.view"));
    assert.ok(slugs.has("drivers.view"));
  });

  it("gives User only their ticks", () => {
    const slugs = resolveSessionPermissionSlugs({
      isSuperAdmin: false,
      accessKind: "user",
      userTicks: ["assets.create"],
      roleSlugs: ["drivers.manage"],
      catalogSlugs: CATALOG_SLUGS,
    });
    assert.deepEqual([...slugs], ["assets.create"]);
  });
});
