import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CATALOG_SLUG_SET } from "@/lib/auth/permission-catalog";
import { RESOURCE_CRUD_MODULES, isStaffMatrixSlug, permissionGrantedByTicks } from "@/lib/auth/staff-access";
import {
  PURGE_ALL_ENTITIES,
  PURGE_ALL_MODULES,
  isPurgeAllEntity,
  purgeAllEntitiesForPermissions,
  purgeAllModuleFor,
  purgeAllModulesForEntities,
} from "./purge-entities";

describe("purge entities", () => {
  it("every module slug is a seeded catalog permission", () => {
    for (const module of PURGE_ALL_MODULES) {
      assert.ok(
        CATALOG_SLUG_SET.has(module.slug),
        `${module.entity} uses a slug the database does not seed: ${module.slug}`,
      );
    }
  });

  it("every slug is a bulk_delete tick, never a manage/delete alias", () => {
    for (const module of PURGE_ALL_MODULES) {
      assert.ok(
        module.slug.endsWith(".bulk_delete"),
        `${module.entity} points at ${module.slug}`,
      );
    }
  });

  it("modules are listed in recommended go-live order", () => {
    const order = PURGE_ALL_MODULES.map((m) => m.goLive);
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b),
      "the panel works top to bottom, so the array order must be the go-live order",
    );
    assert.equal(Math.min(...order), 1);
    assert.equal(Math.max(...order), 6);
  });

  it("has no duplicate entity and no orphan entity", () => {
    const entities = PURGE_ALL_MODULES.map((m) => m.entity);
    assert.equal(entities.length, new Set(entities).size);
    assert.deepEqual([...entities].sort(), [...PURGE_ALL_ENTITIES].sort());
  });

  it("looks a module up by entity", () => {
    assert.equal(purgeAllModuleFor("zones")?.slug, "zones.bulk_delete");
    assert.equal(purgeAllModuleFor("not-a-module"), null);
    assert.equal(isPurgeAllEntity("drivers"), true);
    assert.equal(isPurgeAllEntity("driverss"), false);
  });

  it("shares one tick when a module has no CRUD of its own", () => {
    // Rules sit in the earnings catalog, so clearing them is the earnings tick.
    assert.equal(purgeAllModuleFor("delivery_rules")?.slug, "earnings.bulk_delete");
    assert.equal(purgeAllModuleFor("incentive_rules")?.slug, "earnings.bulk_delete");
    assert.equal(purgeAllModuleFor("payouts")?.slug, "earnings.bulk_delete");
    // …but they stay separate modules, because they are separate tables.
    assert.equal(new Set(["delivery_rules", "incentive_rules", "payouts"]).size, 3);
  });

  it("grants the module only on its own tick", () => {
    for (const verb of ["manage", "create", "edit", "delete"]) {
      const ticks = new Set([`drivers.${verb}`]);
      assert.equal(
        permissionGrantedByTicks(ticks, "drivers.bulk_delete"),
        false,
        `drivers.${verb} must not clear the module`,
      );
    }
    assert.equal(
      permissionGrantedByTicks(new Set(["drivers.bulk_delete"]), "drivers.bulk_delete"),
      true,
    );
  });

  it("filters the module list by tick", () => {
    const entities = purgeAllEntitiesForPermissions(new Set(["zones.bulk_delete"]), false);
    assert.deepEqual(entities, ["zones"]);

    const superAdmin = purgeAllEntitiesForPermissions(new Set(), true);
    assert.equal(superAdmin.length, PURGE_ALL_ENTITIES.length);

    // A manage tick alone clears nothing at all — not even the module it manages.
    assert.deepEqual(purgeAllEntitiesForPermissions(new Set(["zones.manage"]), false), []);
  });

  it("keeps the recommended order whatever order the caller passes", () => {
    const modules = purgeAllModulesForEntities(["zones", "deliveries", "drivers"]);
    assert.deepEqual(
      modules.map((m) => m.entity),
      ["deliveries", "drivers", "zones"],
    );
  });

  it("every bulk_delete slug is a tickable staff-matrix slug", () => {
    // A `.manage` alias is folded away by the editor and could never be ticked,
    // so each purge slug must survive as itself.
    for (const module of PURGE_ALL_MODULES) {
      assert.ok(
        isStaffMatrixSlug(module.slug),
        `${module.slug} would be folded away as a manage alias`,
      );
      assert.ok(
        module.slug.slice(0, -".bulk_delete".length).length > 0,
        `${module.slug} has no namespace`,
      );
    }
  });

  it("keeps the resource matrix able to render the tick it owns", () => {
    // The staff editor draws a column per RESOURCE_CRUD_MODULES entry and puts
    // every other catalog slug in a category group. A module that is listed
    // there must therefore have a real catalog row for its bulk_delete tick.
    const owners = new Set<string>(RESOURCE_CRUD_MODULES);
    for (const module of PURGE_ALL_MODULES) {
      const owner = module.slug.slice(0, -".bulk_delete".length);
      if (!owners.has(owner)) continue;
      assert.ok(
        CATALOG_SLUG_SET.has(module.slug),
        `${module.slug} is dropped from the category group but the matrix has no row for it`,
      );
    }
  });

  it("gives every matrix module a bulk_delete row, so no switch is dead", () => {
    // ResourceTickRow paints one switch per verb without checking the catalog,
    // so a module in the matrix with no seeded row would render a control that
    // can never be saved.
    for (const module of RESOURCE_CRUD_MODULES) {
      assert.ok(
        CATALOG_SLUG_SET.has(`${module}.bulk_delete`),
        `${module} is in the staff matrix but has no ${module}.bulk_delete permission`,
      );
    }
  });
});
