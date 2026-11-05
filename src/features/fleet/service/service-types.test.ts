import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SERVICE_CATEGORY_KEYS,
  categoryForServiceType,
  isServiceCategoryKey,
  normaliseServiceTypeName,
  serviceCategoryLabel,
  serviceTypeKey,
  serviceTypeLabel,
  serviceTypeSearchText,
  SERVICE_TYPE_KEY_RE,
} from "./service-types";
import { previewServiceTypeImport, writableImportRows } from "./service-type-import";

describe("service type catalog", () => {
  it("slugifies a name and keeps the key inside the allowed shape", () => {
    assert.equal(serviceTypeKey("Full service"), "full_service");
    assert.equal(serviceTypeKey("  A/C Compressor (Front)  "), "a_c_compressor_front");
    assert.equal(serviceTypeKey("   "), "service_type");
    for (const name of ["Full service", "Oil filter", "Brake pads — front"]) {
      assert.match(serviceTypeKey(name), SERVICE_TYPE_KEY_RE, name);
    }
  });

  it("folds the sheet's duplicate 'Full service' into one key", () => {
    assert.equal(normaliseServiceTypeName("Full service"), normaliseServiceTypeName("Full service "));
    assert.equal(normaliseServiceTypeName("Full   service"), "full service");
    assert.equal(serviceTypeKey("Full service"), serviceTypeKey("FULL SERVICE"));
  });

  it("derives a category from keywords", () => {
    assert.equal(categoryForServiceType("Front brake pads"), "brakes");
    assert.equal(categoryForServiceType("A/C compressor replacement"), "ac");
    assert.equal(categoryForServiceType("Tyre puncture repair"), "tyres");
    assert.equal(categoryForServiceType("Shock absorber front"), "suspension");
    assert.equal(categoryForServiceType("Windshield glass"), "body");
    assert.equal(categoryForServiceType("Battery replacement"), "electrical");
    assert.equal(categoryForServiceType("Gearbox oil change"), "transmission");
    assert.equal(categoryForServiceType("Oil filter change"), "engine");
    assert.equal(categoryForServiceType("Periodic inspection"), "inspection");
    assert.equal(categoryForServiceType("Labour charge"), "labour");
    assert.equal(categoryForServiceType("Shop supplies"), "consumables");
    // No keyword rule recognises it, and `other` is the honest answer.
    assert.equal(categoryForServiceType("Zzz unknown part"), "other");
    // A short abbreviation must not match inside an unrelated word.
    assert.equal(categoryForServiceType("Track rod end"), "suspension");
  });

  it("prefers Arabic and falls back to English", () => {
    const row = { label_en: "Brake pads", label_ar: "فحمات الفرامل" };
    assert.equal(serviceTypeLabel(row, "ar"), "فحمات الفرامل");
    assert.equal(serviceTypeLabel(row, "en"), "Brake pads");
    assert.equal(serviceTypeLabel({ label_en: "Brake pads", label_ar: "" }, "ar"), "Brake pads");
  });

  it("searches both labels and the category", () => {
    const row = { key: "brake_pads", label_en: "Brake pads", label_ar: "فحمات", category: "brakes" };
    const text = serviceTypeSearchText(row);
    assert.ok(text.includes("brake pads"));
    assert.ok(text.includes("فحمات"));
    assert.ok(text.includes("brakes"));
    assert.ok(text.includes("الفرامل"));
  });

  it("labels every category in both languages", () => {
    for (const key of SERVICE_CATEGORY_KEYS) {
      assert.ok(isServiceCategoryKey(key));
      assert.ok(serviceCategoryLabel(key, "en").length > 0, key);
      assert.ok(serviceCategoryLabel(key, "ar").length > 0, key);
    }
    assert.equal(isServiceCategoryKey("nope"), false);
    assert.equal(serviceCategoryLabel("nope" as never, "en"), "Other");
  });
});

describe("service type import preview", () => {
  const rows = [
    ["Service type"],
    ["Full service"],
    ["Brake pads"],
    ["Full service "],
    ["Oil filter"],
    [""],
  ];

  it("reports the duplicate with its sheet row instead of dropping it", () => {
    const preview = previewServiceTypeImport(rows, []);
    assert.equal(preview.counts.create, 3);
    assert.equal(preview.counts.duplicate, 1);
    const duplicate = preview.items.find((item) => item.status === "duplicate");
    assert.ok(duplicate);
    assert.equal(duplicate?.sheetRow, 4);
    assert.equal(duplicate?.message, "duplicate_of_row:2");
    assert.equal(preview.counts.total, 4);
  });

  it("marks a name the catalog already holds as update, not create", () => {
    const preview = previewServiceTypeImport(rows, [
      { key: "brake_pads", label_en: "Brake pads", label_ar: "", category: "brakes", is_active: true },
    ]);
    assert.equal(preview.counts.update, 1);
    assert.equal(preview.counts.create, 2);
    assert.equal(writableImportRows(preview).length, 3);
  });

  it("accepts the template's Arabic / Category / Active columns", () => {
    const preview = previewServiceTypeImport(
      [
        ["Service type", "Arabic", "Category", "Active"],
        ["Cabin filter", "فلتر المكيف", "ac", "no"],
      ],
      [],
    );
    assert.equal(preview.items.length, 1);
    assert.equal(preview.items[0]?.labelAr, "فلتر المكيف");
    assert.equal(preview.items[0]?.category, "ac");
    assert.equal(preview.items[0]?.active, false);
  });

  it("imports a one-column sheet with no header", () => {
    const preview = previewServiceTypeImport([["Full service"], ["Air filter"]], []);
    assert.equal(preview.counts.create, 2);
    assert.equal(preview.items[0]?.sheetRow, 1);
  });
});
