import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isJobPosition, optionalChoice } from "../drivers/driver-private-fields";
import {
  catalogKeyFromLabel,
  DEFAULT_EMPLOYEE_SECTIONS,
  DEFAULT_EMPLOYEE_STATUSES,
  DEFAULT_BANK_CODES,
  DEFAULT_NATIONALITY_CATEGORIES,
  DEFAULT_SPONSORSHIPS,
  isNbkBank,
  isNonOperationalOnly,
  isOperationalSection,
  mergeCatalogRows,
  parseCatalogRow,
} from "./employee-catalogs";

describe("employee catalogs", () => {
  it("seeds twelve system statuses and marks NBK", () => {
    assert.equal(DEFAULT_EMPLOYEE_STATUSES.length, 12);
    assert.equal(DEFAULT_EMPLOYEE_STATUSES[0]?.key, "new");
    for (const key of ["cancelled", "leave", "leave_return"] as const) {
      assert.equal(DEFAULT_EMPLOYEE_STATUSES.some((row) => row.key === key), true);
    }
    assert.equal(DEFAULT_NATIONALITY_CATEGORIES.length, 20);
    assert.equal(DEFAULT_SPONSORSHIPS.length, 4);
    assert.equal(DEFAULT_BANK_CODES.some((row) => row.is_nbk), true);
    assert.equal(isNbkBank("nbk", DEFAULT_BANK_CODES), true);
    assert.equal(isNbkBank("kfh", DEFAULT_BANK_CODES), false);
  });

  it("optionalChoice clears blank and none, and refuses a value outside the enum", () => {
    assert.deepEqual(optionalChoice("", isJobPosition), { ok: true, value: null });
    assert.deepEqual(optionalChoice("none", isJobPosition), { ok: true, value: null });
    assert.deepEqual(optionalChoice("  rider  ", isJobPosition), { ok: true, value: "rider" });
    assert.deepEqual(optionalChoice("captain", isJobPosition), { ok: false });
    assert.deepEqual(optionalChoice(null, isJobPosition), { ok: true, value: null });
  });

  it("merges stored rows over seeds and keeps missing system keys", () => {
    const stored = [
      parseCatalogRow({
        key: "new",
        label_en: "Fresh",
        label_ar: "جديد",
        is_active: true,
        is_system: true,
        sort_order: 1,
      })!,
    ];
    const merged = mergeCatalogRows(stored, DEFAULT_EMPLOYEE_STATUSES);
    assert.equal(merged.find((row) => row.key === "new")?.label_en, "Fresh");
    assert.equal(merged.some((row) => row.key === "running"), true);
    assert.deepEqual(mergeCatalogRows([], DEFAULT_BANK_CODES).map((row) => row.key), DEFAULT_BANK_CODES.map((row) => row.key));
  });

  it("slugs a label into a catalog key", () => {
    assert.equal(catalogKeyFromLabel("Absent from MOSAL"), "absent_from_mosal");
    assert.equal(parseCatalogRow({ key: "BAD KEY" }), null);
  });

  it("ships MG Head Office as a non-operational section", () => {
    const seed = DEFAULT_EMPLOYEE_SECTIONS.find((row) => row.key === "service_field_mg_head_office");
    assert.ok(seed);
    assert.equal(seed.is_operational, false);
    assert.equal(isOperationalSection("service_field_mg_head_office", DEFAULT_EMPLOYEE_SECTIONS), false);
    // Unknown keys stay operational, and no section at all keeps the gate.
    assert.equal(isOperationalSection("unknown", DEFAULT_EMPLOYEE_SECTIONS), true);
    assert.equal(isNonOperationalOnly([], DEFAULT_EMPLOYEE_SECTIONS), false);
    assert.equal(isNonOperationalOnly(["service_field_mg_head_office"], DEFAULT_EMPLOYEE_SECTIONS), true);
    assert.equal(
      isNonOperationalOnly(["service_field_mg_head_office", "unknown"], DEFAULT_EMPLOYEE_SECTIONS),
      false,
    );
  });

  it("fills a stored row's missing operational flag from the seed", () => {
    const stored = [
      parseCatalogRow({ key: "service_field_mg_head_office", label_en: "Head Office" })!,
    ];
    assert.equal(mergeCatalogRows(stored, DEFAULT_EMPLOYEE_SECTIONS)[0]?.is_operational, false);
    const explicit = [
      parseCatalogRow({
        key: "service_field_mg_head_office",
        label_en: "Head Office",
        is_operational: true,
      })!,
    ];
    assert.equal(mergeCatalogRows(explicit, DEFAULT_EMPLOYEE_SECTIONS)[0]?.is_operational, true);
  });
});
