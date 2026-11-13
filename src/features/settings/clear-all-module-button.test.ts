import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PURGE_ALL_ENTITIES, purgeAllModuleFor } from "./purge-entities";

describe("clear-all-module-button translations & dialog contracts", () => {
  const root = process.cwd();
  const en = JSON.parse(readFileSync(join(root, "src/messages/en.json"), "utf8").replace(/^\uFEFF/, ""));
  const ar = JSON.parse(readFileSync(join(root, "src/messages/ar.json"), "utf8").replace(/^\uFEFF/, ""));

  function getNested(obj: Record<string, unknown>, path: string): unknown {
    return path.split(".").reduce((acc: unknown, part: string) => {
      if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[part];
      }
      return undefined;
    }, obj);
  }

  it("common.cancel is defined as a non-empty string in both EN and AR", () => {
    assert.equal(getNested(en, "common.cancel"), "Cancel");
    assert.equal(getNested(ar, "common.cancel"), "إلغاء");
  });

  it("pages.settings.dataCleanup.common.cancel exists as safety fallback in both locales", () => {
    assert.equal(getNested(en, "pages.settings.dataCleanup.common.cancel"), "Cancel");
    assert.equal(getNested(ar, "pages.settings.dataCleanup.common.cancel"), "إلغاء");
  });

  it("all clearAll.selected messages are defined in both EN and AR", () => {
    const requiredSelectedKeys = [
      "selectFirst",
      "title",
      "body",
      "itemName",
      "confirm",
      "nothing",
      "working",
      "warning",
      "confirmPhrase",
      "success",
      "remaining",
      "blocked",
      "close",
    ];

    for (const locale of [en, ar]) {
      for (const key of requiredSelectedKeys) {
        const val = getNested(locale, `pages.settings.dataCleanup.clearAll.selected.${key}`);
        assert.ok(
          typeof val === "string" && val.length > 0,
          `Missing or empty key: pages.settings.dataCleanup.clearAll.selected.${key}`,
        );
      }
    }
  });

  it("all entities supported by clear-all have a module defined or map cleanly", () => {
    for (const entity of PURGE_ALL_ENTITIES) {
      const module = purgeAllModuleFor(entity);
      assert.ok(module, `Entity ${entity} must resolve to a valid module`);
      assert.equal(module?.entity, entity);
    }
  });
});

