import { ESIGN_EMPLOYEE_ROWS, employeeRowLabel, isEmployeeRowKey } from "./employee-block";
import { templateFieldLabel } from "./template-source";
import type { EsignTemplateFieldRow } from "./types";

/**
 * The example sheet for a bulk import.
 *
 * A bulk send can only work if the sheet's columns match the template's field
 * keys, and the reference design ships an example sheet from the template screen
 * for exactly that reason. The sheet is built from the template rather than
 * hard-coded, so a template that gains a field cannot hand out a stale example —
 * which is the failure mode an example sheet exists to prevent.
 *
 * Two rules are load-bearing:
 *
 * 1. **`Employee ID` is the first column.** The server resolves the rider from it
 *    and fills the whole employee block, so it is the one column a sheet cannot
 *    be without. `Description` follows because the importer understands it.
 * 2. **Reserved employee keys never become columns.** `{{employee_name}}`,
 *    `{{civil_id}}` and the rest resolve from the rider record; a column asking
 *    for them would invite an operator to type a name that the system then
 *    ignores. The database refuses such a field on the template side, and the
 *    sheet refuses to advertise one on the way in, so the two halves agree.
 */

export const EXAMPLE_EMPLOYEE_COLUMN = "Employee ID";
export const EXAMPLE_DESCRIPTION_COLUMN = "Description";

export type EsignExampleSheetField = Pick<
  EsignTemplateFieldRow,
  "field_key" | "label_en" | "label_ar" | "field_type" | "options" | "source_kind" | "is_required"
>;

/** A plausible value per field type, so the example row is importable as-is. */
function sampleValue(field: EsignExampleSheetField): string {
  if (field.source_kind === "fixed") return field.options[0] ?? "";
  switch (field.field_type) {
    case "date":
      return "2026-04-18";
    case "number":
      return "1";
    case "select":
      return field.options[0] ?? "";
    case "textarea":
      return "Notes for this employee";
    default:
      return field.options[0] ?? field.label_en;
  }
}

export type EsignExampleSheet = {
  headers: string[];
  sampleRow: string[];
  csv: string;
};

export function buildEsignExampleSheet(
  fields: EsignExampleSheetField[],
): EsignExampleSheet {
  const sheetFields = fields.filter((field) => !isEmployeeRowKey(field.field_key));
  const headers = [
    EXAMPLE_EMPLOYEE_COLUMN,
    EXAMPLE_DESCRIPTION_COLUMN,
    ...sheetFields.map((field) => field.field_key),
  ];
  const sampleRow = [
    "10042",
    "April 2026",
    ...sheetFields.map((field) => sampleValue(field)),
  ];

  const escape = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  const csv = [headers, sampleRow].map((row) => row.map(escape).join(",")).join("\n");

  return { headers, sampleRow, csv };
}

export type EsignSheetColumn = {
  /**
   * The literal header text the sheet must carry.
   *
   * This is what the operator types, and it is matched exactly — `employee id`
   * and `description` through `EMP_HEADERS` / `DESC_HEADERS`, every template
   * field against its `field_key`. So the chip has to show the header and not
   * the human label: a chip reading "Asset name" sends the operator to a column
   * the parser ignores as a renamed column, which is the one failure the hint
   * under the table explicitly promises will not happen.
   */
  header: string;
  /** The template's own label, shown beside the key so it is readable. */
  label?: string;
  required: boolean;
};

export type EsignSheetColumnGroups = {
  /** Columns the server fills from the rider record — never sheet columns. */
  system: string[];
  /** Columns the sheet must carry, in the order the example sheet emits them. */
  sheet: EsignSheetColumn[];
};

/**
 * The two column lists the bulk wizard shows in step 1 and step 3.
 *
 * Derived from the same `fields` the example sheet is built from, in the same
 * module, so the two cannot drift — which they did, twice.
 *
 * **The system group is the employee block, minus `Employee ID`.** It used to be
 * read from `source_kind = 'system'` field rows, which is empty for every
 * template in the database because the block is not stored as field rows, so the
 * one group the reference always shows was silently absent. It is now the shared
 * catalogue the builder and both renderers read. `Employee ID` is deliberately
 * *excluded*: it is the key the operator supplies and the column the sheet must
 * lead with, and listing it here as well told the operator it was supplied for
 * them while the group beside it demanded it.
 *
 * **The sheet group is every remaining field, under its `field_key`.** Not its
 * label, and not filtered by `source_kind`: `buildEsignExampleSheet` emits a
 * column for every field whose key is not an employee key,
 * `parseEsignBulkRows` reads a column into `field_values` for every field key it
 * can match, and `admin_create_esign_request` refuses the row with
 * `field_required` when a required field is missing. A third "Fixed in the
 * template" group used to promise those columns were supplied for you, which
 * asserted the opposite of the example sheet printed beneath it.
 */
export function bulkSheetColumns(
  fields: EsignExampleSheetField[],
  locale: string,
): EsignSheetColumnGroups {
  return {
    system: ESIGN_EMPLOYEE_ROWS.filter((row) => row.key !== "employee_id").map((row) =>
      employeeRowLabel(row, locale === "ar" ? "ar" : "en"),
    ),
    sheet: [
      { header: EXAMPLE_EMPLOYEE_COLUMN, required: true },
      { header: EXAMPLE_DESCRIPTION_COLUMN, required: false },
      ...fields
        .filter((field) => !isEmployeeRowKey(field.field_key))
        .map((field) => ({
          header: field.field_key,
          label: templateFieldLabel(field, locale),
          required: field.is_required,
        })),
    ],
  };
}
