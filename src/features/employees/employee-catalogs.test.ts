import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  catalogKeyFromLabel,
  DEFAULT_EMPLOYEE_STATUSES,
  DEFAULT_BANK_CODES,
  isNbkBank,
  mergeCatalogRows,
  parseCatalogRow,
} from "./employee-catalogs";

describe("employee catalogs", () => {
  it("seeds nine system statuses and marks NBK", () => {
    assert.equal(DEFAULT_EMPLOYEE_STATUSES.length, 9);
    assert.equal(DEFAULT_EMPLOYEE_STATUSES[0]?.key, "new");
    assert.equal(DEFAULT_BANK_CODES.some((row) => row.is_nbk), true);
    assert.equal(isNbkBank("nbk", DEFAULT_BANK_CODES), true);
    assert.equal(isNbkBank("kfh", DEFAULT_BANK_CODES), false);
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
});
