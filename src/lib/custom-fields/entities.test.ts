import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_ENTITY_KEYS,
  customFieldEntity,
  isCustomFieldEntity,
} from "./entities";
import { DRIVER_ENTITY_TYPE } from "./types";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Client review 5.1 / 5.2: an operator adds a column and a slicer in Operations
 * Hub, only Super Admin may do it, and every page that reads the entity picks it
 * up. The registry is what makes that one mechanism instead of five.
 */
describe("custom field entities", () => {
  it("keeps Employees and the master-data tables that have an edit form", () => {
    assert.deepEqual(
      [...CUSTOM_FIELD_ENTITY_KEYS].sort(),
      ["driver", "partner", "restaurant", "vehicle", "zone"],
    );
  });

  it("every entity names a collection and both slugs", () => {
    for (const entity of CUSTOM_FIELD_ENTITIES) {
      assert.ok(entity.collection.length > 0, entity.key);
      assert.ok(entity.viewPermission.endsWith(".view"), entity.key);
      assert.ok(entity.managePermission.endsWith(".manage"), entity.key);
      assert.equal(entity.collection, entity.key === DRIVER_ENTITY_TYPE ? "drivers" : entity.collection);
    }
  });

  it("does not offer a transactional table", () => {
    // A definition needs somewhere to be written; a delivery has no edit form.
    for (const key of ["delivery", "attendance", "order_exception"]) {
      assert.equal(isCustomFieldEntity(key), false, key);
      assert.equal(customFieldEntity(key), null, key);
    }
  });

  it("resolves a known key to its entry", () => {
    const partner = customFieldEntity("partner");
    assert.ok(partner);
    assert.equal(partner.collection, "partners");
    assert.equal(partner.viewPermission, "partners.view");
  });
});

describe("custom field definition gate", () => {
  const source = readFileSync(
    join(here, "..", "..", "features", "custom-fields", "custom-fields-actions.ts"),
    "utf8",
  );

  it("writes definitions behind a super-admin check, not a module tick", () => {
    // 5.2: a definition is shared configuration. `drivers.manage` would let a
    // manager add a column every staff member reads, which is the wrong authority.
    assert.match(source, /async function requireDefinitionAdmin\(\)[\s\S]{0,220}?isSuperAdmin/);
    const definitions = source.slice(
      source.indexOf("export async function upsertCustomFieldDefinition"),
      source.indexOf("export async function setCustomFieldActive"),
    );
    assert.ok(definitions.length > 0);
    assert.match(definitions, /requireDefinitionAdmin\(\)/);
    assert.equal(
      /requireDriversManage\(\)/.test(definitions),
      false,
      "a definition write still accepts a module tick",
    );
  });

  it("rejects an entity that is not in the registry", () => {
    assert.match(source, /isCustomFieldEntity\(entityType\)\) return \{ error: "invalid_entity" \}/);
  });

  it("reading definitions follows the entity's own list permission", () => {
    assert.match(source, /entry\.viewPermission/);
  });
});
