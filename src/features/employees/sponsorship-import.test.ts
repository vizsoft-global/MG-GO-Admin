import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SPONSORSHIPS } from "./employee-catalogs";
import {
  previewSponsorshipImport,
  SPONSORSHIP_IMPORT_CAP,
  sponsorshipImportFieldForHeader,
  sponsorshipImportTemplateSheets,
  type SponsorshipImportExisting,
} from "./sponsorship-import";

const EXISTING: SponsorshipImportExisting[] = DEFAULT_SPONSORSHIPS.map((row) => ({
  key: row.key,
  label_en: row.label_en,
  label_ar: row.label_ar,
  is_active: row.is_active,
  is_system: row.is_system,
  sort_order: row.sort_order,
}));

const HEADERS = ["Key", "English", "Arabic", "Active", "Sort"];

describe("sponsorship import preview", () => {
  it("maps header aliases", () => {
    assert.equal(sponsorshipImportFieldForHeader("Key"), "key");
    assert.equal(sponsorshipImportFieldForHeader("Label EN"), "english");
    assert.equal(sponsorshipImportFieldForHeader("Active (yes/no)"), "active");
    assert.equal(sponsorshipImportFieldForHeader("Sort order"), "sort");
  });

  it("creates from English when Key is blank", () => {
    const preview = previewSponsorshipImport({
      headers: HEADERS,
      rows: [["", "Musallam Group", "مجموعة مسلم", "yes", "50"]],
      existing: EXISTING,
    });
    assert.equal(preview.error, null);
    assert.equal(preview.rows[0]?.status, "create");
    assert.equal(preview.rows[0]?.payload?.key, "musallam_group");
    assert.equal(preview.rows[0]?.payload?.is_system, false);
  });

  it("keeps stored labels on a blank update", () => {
    const preview = previewSponsorshipImport({
      headers: HEADERS,
      rows: [["in_house", "", "", "", ""]],
      existing: EXISTING,
    });
    assert.equal(preview.rows[0]?.status, "update");
    assert.equal(preview.rows[0]?.payload?.label_en, "In-house");
    assert.equal(preview.rows[0]?.payload?.label_ar, "داخلي");
    assert.equal(preview.rows[0]?.payload?.is_active, true);
    assert.equal(preview.rows[0]?.payload?.sort_order, 10);
  });

  it("refuses deactivating a system row", () => {
    const preview = previewSponsorshipImport({
      headers: HEADERS,
      rows: [["in_house", "In-house", "داخلي", "no", "10"]],
      existing: EXISTING,
    });
    assert.equal(preview.rows[0]?.status, "error");
    assert.equal(preview.rows[0]?.error, "system_status_locked");
  });

  it("marks duplicate keys as errors on both rows", () => {
    const preview = previewSponsorshipImport({
      headers: HEADERS,
      rows: [
        ["vendor_a", "Vendor A", "", "yes", "1"],
        ["vendor_a", "Vendor A 2", "", "yes", "2"],
      ],
      existing: EXISTING,
    });
    assert.equal(preview.rows[0]?.error, "duplicate_key");
    assert.equal(preview.rows[1]?.error, "duplicate_key");
  });

  it("copies English when Arabic is a dash", () => {
    const preview = previewSponsorshipImport({
      headers: HEADERS,
      rows: [["vendor_b", "Vendor B", "-", "yes", "1"]],
      existing: EXISTING,
    });
    assert.equal(preview.rows[0]?.payload?.label_ar, "Vendor B");
  });

  it("refuses an empty sheet and a missing English/Key column", () => {
    assert.equal(
      previewSponsorshipImport({ headers: HEADERS, rows: [["", "", "", "", ""]], existing: EXISTING }).error,
      "empty",
    );
    assert.equal(
      previewSponsorshipImport({ headers: ["Active", "Sort"], rows: [["yes", "1"]], existing: EXISTING }).error,
      "missing_columns",
    );
  });

  it("caps the sheet at 200 data rows", () => {
    const rows = Array.from({ length: SPONSORSHIP_IMPORT_CAP + 1 }, (_, i) => [
      `row_${i}`,
      `Row ${i}`,
      "",
      "yes",
      String(i),
    ]);
    assert.equal(previewSponsorshipImport({ headers: HEADERS, rows, existing: EXISTING }).error, "too_many");
  });

  it("ships the four system keys on the sample sheet", () => {
    const sheets = sponsorshipImportTemplateSheets();
    assert.equal(sheets[0]?.name, "Sponsorships");
    const keys = (sheets[0]?.aoa.slice(1) ?? []).map((row) => row[0]);
    assert.deepEqual(keys, ["in_house", "partner", "outsourced", "government"]);
  });
});
