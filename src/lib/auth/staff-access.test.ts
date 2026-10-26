import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CATALOG_SLUGS, CATALOG_SLUG_SET } from "./permission-catalog";
import { hasPermissionInSet } from "./permissions";
import {
  expandRoleSlugsToUserTicks,
  isStaffMatrixSlug,
  managerDowngradeSeedTicks,
  migratedSessionIsSupersetOfRole,
  parsePartnerProjectKey,
  parseStaffAccessKind,
  permissionGrantedByTicks,
  resolveSessionPermissionSlugs,
  roleSlugsForSave,
  staffRolePrivilegeChange,
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

describe("staff role privilege change", () => {
  it("lets a super admin move someone off Super Admin when another remains", () => {
    assert.equal(
      staffRolePrivilegeChange({
        callerIsSuperAdmin: true,
        previousIsSuperAdmin: true,
        nextIsSuperAdmin: false,
        otherSuperAdminCount: 1,
      }),
      "ok",
    );
  });

  it("refuses to remove the last Super Admin", () => {
    assert.equal(
      staffRolePrivilegeChange({
        callerIsSuperAdmin: true,
        previousIsSuperAdmin: true,
        nextIsSuperAdmin: false,
        otherSuperAdminCount: 0,
      }),
      "last_super_admin",
    );
  });

  it("refuses a non-super admin granting Super Admin", () => {
    assert.equal(
      staffRolePrivilegeChange({
        callerIsSuperAdmin: false,
        previousIsSuperAdmin: false,
        nextIsSuperAdmin: true,
        otherSuperAdminCount: 1,
      }),
      "not_authorized",
    );
  });

  it("allows an ordinary role change", () => {
    assert.equal(
      staffRolePrivilegeChange({
        callerIsSuperAdmin: false,
        previousIsSuperAdmin: false,
        nextIsSuperAdmin: false,
        otherSuperAdminCount: 0,
      }),
      "ok",
    );
  });
});

describe("staff access ticks", () => {
  it("expands CRUD manage into create/edit/delete and keeps extra verbs", () => {
    const ticks = expandRoleSlugsToUserTicks(OPERATOR_ROLE);
    assert.equal(ticks.has("drivers.manage"), false);
    assert.ok(ticks.has("drivers.create"));
    assert.ok(ticks.has("drivers.edit"));
    assert.ok(ticks.has("drivers.delete"));
    assert.equal(ticks.has("drivers.bulk_delete"), false);
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
    assert.ok(seeded.has("drivers.bulk_delete"));
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

  it("does not treat bulk_delete as a manage alias", () => {
    assert.equal(permissionGrantedByTicks(new Set(["assets.manage"]), "assets.bulk_delete"), false);
    assert.equal(permissionGrantedByTicks(new Set(["assets.delete"]), "assets.bulk_delete"), false);
    assert.equal(permissionGrantedByTicks(new Set(["assets.bulk_delete"]), "assets.bulk_delete"), true);
    assert.equal(permissionGrantedByTicks(new Set(["assets.bulk_delete"]), "assets.delete"), false);
    const saved = new Set(roleSlugsForSave(["assets.bulk_delete"]));
    assert.ok(saved.has("assets.bulk_delete"));
    assert.equal(saved.has("assets.manage"), false);
    const expanded = expandRoleSlugsToUserTicks(["assets.manage", "assets.delete"]);
    assert.equal(expanded.has("assets.bulk_delete"), false);
  });

  it("hides .manage for new write modules and keeps their view slugs on the matrix", () => {
    assert.equal(isStaffMatrixSlug("payroll.manage"), false);
    assert.equal(isStaffMatrixSlug("fuel.manage"), false);
    assert.equal(isStaffMatrixSlug("companies.manage"), false);
    assert.equal(isStaffMatrixSlug("order_recon.manage"), false);
    assert.ok(isStaffMatrixSlug("payroll.edit"));
    assert.ok(isStaffMatrixSlug("fuel.create"));
    assert.ok(isStaffMatrixSlug("companies.view"));
    assert.ok(isStaffMatrixSlug("order_recon.view"));
    assert.ok(isStaffMatrixSlug("live_tracking.view"));
    assert.ok(isStaffMatrixSlug("fuel_requests.view"));
    assert.ok(isStaffMatrixSlug("fuel_refunds.view"));
    assert.ok(isStaffMatrixSlug("asset_requests.view"));
  });
});

describe("hasPermissionInSet manage alias", () => {
  it("lets a pre-migration manage slug unlock create/edit/delete", () => {
    const role = new Set(["assets.manage"]);
    assert.equal(hasPermissionInSet(role, "assets.create", false), true);
    assert.equal(hasPermissionInSet(role, "assets.edit", false), true);
    assert.equal(hasPermissionInSet(role, "assets.delete", false), true);
    assert.equal(hasPermissionInSet(role, "assets.bulk_delete", false), false);
  });

  it("lets migrated create/edit/delete unlock manage, but not the missing verb", () => {
    const ticks = new Set(["assets.create"]);
    assert.equal(hasPermissionInSet(ticks, "assets.manage", false), true);
    assert.equal(hasPermissionInSet(ticks, "assets.create", false), true);
    assert.equal(hasPermissionInSet(ticks, "assets.delete", false), false);
    assert.equal(hasPermissionInSet(ticks, "assets.bulk_delete", false), false);
  });

  it("aliases payroll and fuel manage onto create/edit/delete", () => {
    assert.equal(hasPermissionInSet(new Set(["payroll.manage"]), "payroll.edit", false), true);
    assert.equal(hasPermissionInSet(new Set(["payroll.create"]), "payroll.manage", false), true);
    assert.equal(hasPermissionInSet(new Set(["fuel.view"]), "fuel.edit", false), false);
    assert.equal(hasPermissionInSet(new Set(["fuel.edit"]), "fuel.manage", false), true);
    assert.equal(hasPermissionInSet(new Set(["companies.create"]), "companies.manage", false), true);
    assert.equal(hasPermissionInSet(new Set(["order_recon.manage"]), "order_recon.create", false), true);
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

  it("keeps role-granted view and a User tick after Role defaults UI is unmounted", () => {
    assert.equal(hasPermissionInSet(new Set(["drivers.view"]), "drivers.view", false), true);
    assert.equal(hasPermissionInSet(new Set(["payroll.view"]), "payroll.view", false), true);
    const roleSession = resolveSessionPermissionSlugs({
      isSuperAdmin: false,
      accessKind: null,
      userTicks: null,
      roleSlugs: ["drivers.view"],
      catalogSlugs: CATALOG_SLUGS,
    });
    assert.ok(roleSession.has("drivers.view"));
    const userSession = resolveSessionPermissionSlugs({
      isSuperAdmin: false,
      accessKind: "user",
      userTicks: ["payroll.view"],
      roleSlugs: ["drivers.view"],
      catalogSlugs: CATALOG_SLUGS,
    });
    assert.ok(userSession.has("payroll.view"));
    assert.equal(userSession.has("drivers.view"), false);
  });

  it("opens data cleanup when a User holds any bulk_delete tick", () => {
    const slugs = resolveSessionPermissionSlugs({
      isSuperAdmin: false,
      accessKind: "user",
      userTicks: ["drivers.bulk_delete"],
      roleSlugs: [],
      catalogSlugs: CATALOG_SLUGS,
    });
    assert.ok(slugs.has("drivers.bulk_delete"));
    assert.ok(slugs.has("data.cleanup"));
  });

  it("gives a partner only client_portal.view and drivers.view", () => {
    const slugs = resolveSessionPermissionSlugs({
      isSuperAdmin: false,
      accessKind: "partner",
      userTicks: ["payroll.view"],
      roleSlugs: ["payroll.view", "settings.view"],
      catalogSlugs: ["payroll.view", "settings.view", "drivers.view", "client_portal.view"],
    });
    assert.deepEqual([...slugs].sort(), ["client_portal.view", "drivers.view"].sort());
    assert.equal(slugs.has("payroll.view"), false);
    assert.equal(slugs.has("settings.view"), false);
  });

  it("parses partner kind and project keys", () => {
    assert.equal(parseStaffAccessKind("partner"), "partner");
    assert.equal(parsePartnerProjectKey("unset"), null);
    assert.equal(parsePartnerProjectKey(""), null);
    assert.equal(parsePartnerProjectKey("keeta"), "keeta");
    assert.equal(parsePartnerProjectKey("americana"), "americana");
  });
});

describe("access retention after Role defaults UI unmount", () => {
  it("keeps role-granted drivers.view and a user tick payroll.view", () => {
    // RolesPermissionsPanel is unmounted only. Session load in get-session.ts
    // still resolves role slugs and user ticks. Hiding Role defaults does not
    // call saveRolePermissions or wipe admin_role_permissions / admin_user_permissions.
    assert.equal(hasPermissionInSet(new Set(["drivers.view"]), "drivers.view", false), true);
    assert.equal(hasPermissionInSet(new Set(["payroll.view"]), "payroll.view", false), true);
    const userTicks = resolveSessionPermissionSlugs({
      isSuperAdmin: false,
      accessKind: "user",
      userTicks: ["payroll.view"],
      roleSlugs: ["drivers.view"],
      catalogSlugs: CATALOG_SLUGS,
    });
    assert.equal(userTicks.has("payroll.view"), true);
    const roleGranted = resolveSessionPermissionSlugs({
      isSuperAdmin: false,
      accessKind: null,
      userTicks: null,
      roleSlugs: ["drivers.view"],
      catalogSlugs: CATALOG_SLUGS,
    });
    assert.equal(roleGranted.has("drivers.view"), true);
  });
});
