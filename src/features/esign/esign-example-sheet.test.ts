import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  buildEsignExampleSheet,
  bulkSheetColumns,
  EXAMPLE_DESCRIPTION_COLUMN,
  EXAMPLE_EMPLOYEE_COLUMN,
  type EsignExampleSheetField,
} from "./esign-example-sheet";

const fields: EsignExampleSheetField[] = [
  { field_key: "penalty_type", label_en: "Penalty details", label_ar: null, field_type: "select", options: ["Two days", "Five days"], source_kind: "entry", is_required: true },
  { field_key: "violation_date", label_en: "Date of violation", label_ar: null, field_type: "date", options: [], source_kind: "entry", is_required: false },
  { field_key: "notes", label_en: "Remarks", label_ar: null, field_type: "text", options: [], source_kind: "entry", is_required: false },
  { field_key: "employee_name", label_en: "Employee name", label_ar: null, field_type: "text", options: [], source_kind: "system", is_required: false },
  { field_key: "civil_id", label_en: "Civil ID", label_ar: null, field_type: "text", options: [], source_kind: "system", is_required: false },
];

describe("esign example sheet", () => {
  it("leads with Employee ID and Description", () => {
    const sheet = buildEsignExampleSheet(fields);
    assert.equal(sheet.headers[0], EXAMPLE_EMPLOYEE_COLUMN);
    assert.equal(sheet.headers[1], EXAMPLE_DESCRIPTION_COLUMN);
  });

  it("emits one column per template field key", () => {
    const sheet = buildEsignExampleSheet(fields);
    assert.deepEqual(sheet.headers.slice(2), [
      "penalty_type",
      "violation_date",
      "notes",
    ]);
  });

  it("never advertises a reserved employee key as a column", () => {
    const sheet = buildEsignExampleSheet(fields);
    for (const reserved of ["employee_name", "employee_id", "civil_id", "joined_at"]) {
      assert.ok(
        !sheet.headers.includes(reserved),
        `${reserved} must not be a sheet column`,
      );
    }
  });

  it("samples a select with its first option and a date as ISO", () => {
    const sheet = buildEsignExampleSheet(fields);
    assert.equal(sheet.sampleRow[2], "Two days");
    assert.equal(sheet.sampleRow[3], "2026-04-18");
  });

  it("quotes a value that carries a comma", () => {
    const sheet = buildEsignExampleSheet([
      { field_key: "reason", label_en: "Reason", label_ar: null, field_type: "text", options: ["a, b"], source_kind: "fixed", is_required: false },
    ]);
    assert.ok(sheet.csv.includes('"a, b"'));
  });

  it("round-trips the headers back through the bulk parser", () => {
    const sheet = buildEsignExampleSheet(fields);
    const headerLine = sheet.csv.split("\n")[0].split(",");
    assert.deepEqual(headerLine, sheet.headers);
  });
});

describe("bulk sheet column groups", () => {
  it("lists the sheet's columns under their headers, not their labels", () => {
    const groups = bulkSheetColumns(fields, "en");
    assert.deepEqual(
      groups.sheet.map((column) => column.header),
      ["Employee ID", "Description", "penalty_type", "violation_date", "notes"],
    );
    // The label rides along so a snake_case key is still readable, and only the
    // template's own field can carry one.
    assert.equal(groups.sheet[2].label, "Penalty details");
    assert.equal(groups.sheet[0].label, undefined);
  });

  /**
   * The contract this whole module exists to hold: every column the example
   * sheet hands out is named on the screen, and nothing else is. A chip showing
   * "Penalty details" instead of `penalty_type` sends the operator to a column
   * `parseEsignBulkRows` ignores as renamed, while the hint under the review
   * table promises a renamed column is never guessed.
   */
  it("names exactly the columns the example sheet emits", () => {
    const groups = bulkSheetColumns(fields, "en");
    assert.deepEqual(
      groups.sheet.map((column) => column.header),
      buildEsignExampleSheet(fields).headers,
    );
  });

  it("fills the system group from the employee block and leaves Employee ID to the operator", () => {
    const groups = bulkSheetColumns(fields, "en");
    assert.deepEqual(groups.system, [
      "Company",
      "Employee name",
      "Driver ID",
      "Civil ID",
      "Joining date",
      "Accommodation",
      "Zone",
      "Project",
      "Nationality",
    ]);
    assert.ok(
      !groups.system.includes(EXAMPLE_EMPLOYEE_COLUMN),
      "Employee ID is supplied by the sheet, so it must not also read as system-filled",
    );
  });

  it("carries the template's required flag onto the column", () => {
    const groups = bulkSheetColumns(fields, "en");
    const byHeader = new Map(groups.sheet.map((column) => [column.header, column]));
    assert.equal(byHeader.get("Employee ID")?.required, true);
    assert.equal(byHeader.get("penalty_type")?.required, true);
    assert.equal(byHeader.get("notes")?.required, false);
    assert.equal(byHeader.get("Description")?.required, false);
  });

  it("translates the system block with the locale", () => {
    const groups = bulkSheetColumns(fields, "ar");
    assert.equal(groups.system[0], "الشركة");
    assert.ok(!groups.system.includes("Company"));
  });
});
