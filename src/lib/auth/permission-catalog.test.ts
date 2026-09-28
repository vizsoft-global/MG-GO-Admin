import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CATALOG_SLUG_SET, PERMISSION_CATALOG } from "./permission-catalog";
import { PERMISSIONS } from "./permissions";
import { MENU_REGISTRY } from "@/lib/menu/menu-registry";

describe("permission catalog", () => {
  it("every PERMISSIONS key exists in catalog", () => {
    for (const slug of Object.values(PERMISSIONS)) {
      assert.ok(CATALOG_SLUG_SET.has(slug), `Missing catalog entry: ${slug}`);
    }
  });

  it("every MENU_REGISTRY permission exists in catalog", () => {
    for (const item of MENU_REGISTRY) {
      if (!item.permission) continue;
      assert.ok(
        CATALOG_SLUG_SET.has(item.permission),
        `Menu item ${item.id} uses unknown permission: ${item.permission}`,
      );
    }
  });

  it("catalog has no duplicate slugs", () => {
    const slugs = PERMISSION_CATALOG.map((e) => e.slug);
    assert.equal(slugs.length, new Set(slugs).size);
  });

  it("staff-access new page slugs are in the catalog", () => {
    for (const slug of [
      "live_tracking.view",
      "fuel_requests.view",
      "fuel_refunds.view",
      "asset_requests.view",
      "fuel.manage",
      "fuel.create",
      "fuel.edit",
      "payroll.create",
      "payroll.edit",
      "companies.view",
      "companies.edit",
      "order_recon.view",
      "order_recon.manage",
    ]) {
      assert.ok(CATALOG_SLUG_SET.has(slug), `missing ${slug}`);
    }
  });
});
