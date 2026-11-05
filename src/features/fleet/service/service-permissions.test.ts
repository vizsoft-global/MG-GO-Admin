import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { CATALOG_SLUG_SET } from "@/lib/auth/permission-catalog";
import { APP_ACCESS_CATALOG, slugsForLevel, ticksToAppAccess } from "@/lib/auth/app-access";
import { hasPermissionInSet } from "@/lib/auth/permissions";

const MODULE_DIR = join(process.cwd(), "src", "features", "fleet", "service");

function moduleFiles(dir = MODULE_DIR, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) moduleFiles(full, out);
    // The suites themselves name the collections they forbid, so they are skipped.
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("service permissions", () => {
  it("puts the three slugs in the catalog", () => {
    for (const slug of ["service.view", "service.manage", "service.export"]) {
      assert.ok(CATALOG_SLUG_SET.has(slug), `missing ${slug}`);
    }
  });

  it("exposes the three tabs as sub-views on the vehicles app", () => {
    const entry = APP_ACCESS_CATALOG.find((item) => item.appId === "vehicles");
    assert.ok(entry);
    const ids = new Set(entry?.subViews.map((view) => view.id));
    for (const id of ["serviceRecords", "serviceReports", "serviceMaintenance"]) {
      assert.ok(ids.has(id), `missing sub-view ${id}`);
    }
    for (const view of entry?.subViews ?? []) {
      if (!view.id.startsWith("service")) continue;
      assert.deepEqual([...view.slugs], ["service.view"]);
    }
  });

  it("does not hand manage or export out through an app level", () => {
    const entry = APP_ACCESS_CATALOG.find((item) => item.appId === "vehicles");
    assert.ok(entry);
    for (const level of ["viewer", "user", "manager"] as const) {
      const slugs = slugsForLevel(entry!, level);
      assert.equal(slugs.includes("service.manage"), false, level);
      assert.equal(slugs.includes("service.export"), false, level);
    }
  });

  it("refuses the manage path to a seat that only holds service.view", () => {
    const ticks = new Set(["service.view"]);
    assert.equal(hasPermissionInSet(ticks, "service.view", false), true);
    assert.equal(hasPermissionInSet(ticks, "service.manage", false), false);
    assert.equal(hasPermissionInSet(ticks, "service.export", false), false);
    // A super admin still bypasses, exactly like every other page.
    assert.equal(hasPermissionInSet(ticks, "service.manage", true), true);
  });

  it("never writes a role or user grant from module code", () => {
    const banned = [
      "adminRolePermissions",
      "adminUserPermissions",
      "admin_role_permissions",
      "admin_user_permissions",
      "grantServicePermission",
    ];
    for (const file of moduleFiles()) {
      const text = readFileSync(file, "utf8");
      for (const needle of banned) {
        assert.equal(text.includes(needle), false, `${file} mentions ${needle}`);
      }
    }
  });

  it("round-trips a vehicles viewer seat with the service tabs ticked", () => {
    const state = ticksToAppAccess(["vehicles.view", "service.view"]);
    assert.equal(state.vehicles.level, "viewer");
    assert.deepEqual(state.vehicles.subViews.sort(), [
      "serviceMaintenance",
      "serviceRecords",
      "serviceReports",
    ]);
  });
});
