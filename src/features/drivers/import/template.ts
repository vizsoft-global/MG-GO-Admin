import type { CustomFieldOption, CustomFieldType } from "@/lib/custom-fields/types";
import { customFieldColumnId } from "@/lib/custom-fields/types";
import {
  DRIVER_IMPORT_REQUIRED_FIELDS,
  type DriverImportStandardField,
  type DriverImportTargetField,
} from "../types";

export type DriverImportColumnSpec = {
  /** Mapping target this column feeds. */
  field: DriverImportTargetField;
  /** Header text written into the sheet. */
  header: string;
  required: boolean;
  /** What the cell may contain, shown on the Guide sheet. */
  allowed: string;
  example: string;
};

const REQUIRED = new Set<string>(DRIVER_IMPORT_REQUIRED_FIELDS);

/**
 * Single source of truth for the template: header text, the example row, and
 * the Guide sheet all read from here, so a column can never be documented as
 * something other than what it is.
 *
 * Header text is also what `guessColumnMapping` matches on, so it may be
 * reworded but must keep containing that field's needle.
 *
 * Required columns come first, and Full Name first of all: `guessColumnMapping`
 * returns the first header matching any needle, and "name" would otherwise let
 * Client Name capture the full-name mapping.
 */
const STANDARD_COLUMNS: Array<Omit<DriverImportColumnSpec, "required"> & {
  field: DriverImportStandardField;
}> = [
  {
    field: "full_name",
    header: "Full Name",
    allowed: "Any text.",
    example: "Ahmed Ali",
  },
  {
    field: "employee_id",
    header: "Employee ID",
    allowed: "4 to 8 digits. Must be unique — this is half the app login.",
    example: "12345",
  },
  {
    field: "restaurant_ids",
    header: "Restaurant IDs",
    allowed:
      "Restaurant name, RST code, or UUID. Separate several with commas. See the Restaurants sheet.",
    example: "RST-0001",
  },
  {
    field: "phone",
    header: "Phone",
    allowed:
      "Kuwait mobile, with or without +965. Must be unique. Leave blank if unknown.",
    example: "+96599123456",
  },
  {
    field: "civil_id",
    header: "Civil ID",
    allowed: "12 digits. Must be unique. Leave blank if unknown.",
    example: "281010100001",
  },
  {
    field: "partner_id",
    header: "Partner",
    allowed: "Partner name or UUID. See the Partners sheet.",
    example: "",
  },
  {
    field: "zone_id",
    header: "Zone",
    allowed: "Zone name, zone code, or UUID. See the Zones sheet.",
    example: "",
  },
  {
    field: "vehicle_label",
    header: "Vehicle",
    allowed: "Bike ID or registration number of an existing vehicle.",
    example: "BIKE-1024",
  },
  {
    field: "nationality",
    header: "Nationality",
    allowed: "Country name or 2-letter ISO code, e.g. IN, EG, KW.",
    example: "IN",
  },
  {
    field: "rider_category",
    header: "Rider Category",
    allowed: "in_house or outsourced. Blank means in_house.",
    example: "in_house",
  },
  {
    field: "client_id",
    header: "Client ID",
    allowed: "Any text up to 64 characters. Riders on one contract may share it.",
    example: "CLI-204",
  },
  {
    field: "client_name",
    header: "Client Name",
    allowed: "Any text up to 120 characters.",
    example: "Gulf Retail Group",
  },
  {
    field: "active",
    header: "Active",
    allowed:
      "yes or no. Blank defers to the Approve immediately switch in the import dialog.",
    example: "yes",
  },
];

export const DRIVER_IMPORT_COLUMNS: readonly DriverImportColumnSpec[] =
  STANDARD_COLUMNS.map((column) => ({
    ...column,
    required: REQUIRED.has(column.field),
  }));

/** Legacy positional exports — the full template, every column, in order. */
export const DRIVER_IMPORT_HEADERS = DRIVER_IMPORT_COLUMNS.map((c) => c.header);
export const DRIVER_IMPORT_SAMPLE_ROW = DRIVER_IMPORT_COLUMNS.map((c) => c.example);

export const DRIVER_IMPORT_TEMPLATE_PATH = "/api/drivers/import-template.xlsx";

/** Query key carrying the operator's column choice to the template route. */
export const TEMPLATE_COLUMNS_PARAM = "cols";

export type DriverImportCustomColumn = {
  key: string;
  label: string;
  field_type: CustomFieldType;
  options: CustomFieldOption[];
};

function describeCustomField(column: DriverImportCustomColumn): string {
  switch (column.field_type) {
    case "number":
      return "A number.";
    case "date":
      return "A date, formatted YYYY-MM-DD.";
    case "checkbox":
      return column.options.length > 0
        ? `One or more of: ${column.options.map((o) => o.value).join(", ")}. Separate with commas.`
        : "yes or no.";
    case "select":
      return column.options.length > 0
        ? `One of: ${column.options.map((o) => o.value).join(", ")}.`
        : "Any text.";
    default:
      return "Any text.";
  }
}

/**
 * The example also lands in the sample row of the Drivers sheet, so it has to
 * be a value the importer would actually accept — an illustrative-but-invalid
 * one would fail the preview of any sheet the operator forgot to overwrite.
 * A free-text field has no such value to offer, so it stays blank.
 */
function exampleCustomField(column: DriverImportCustomColumn): string {
  const firstOption = column.options[0]?.value ?? "";
  switch (column.field_type) {
    case "number":
      return "1";
    case "date":
      return "2026-01-31";
    case "checkbox":
      return firstOption || "yes";
    case "select":
      return firstOption;
    default:
      return "";
  }
}

export function customFieldColumnSpec(
  column: DriverImportCustomColumn,
): DriverImportColumnSpec {
  return {
    field: customFieldColumnId(column.key) as DriverImportTargetField,
    header: column.label || column.key,
    required: false,
    allowed: describeCustomField(column),
    example: exampleCustomField(column),
  };
}

/**
 * Resolve the operator's tick boxes into the columns the workbook will carry.
 *
 * `selected` of `null` means "no choice expressed" and yields every column,
 * which is what keeps a plain download of the template complete. A required
 * column is always present regardless of what was ticked — a template that
 * cannot be imported is not a template.
 */
export function resolveTemplateColumns(
  selected: readonly string[] | null,
  customColumns: readonly DriverImportCustomColumn[] = [],
): DriverImportColumnSpec[] {
  const all = [
    ...DRIVER_IMPORT_COLUMNS,
    ...customColumns.map(customFieldColumnSpec),
  ];
  if (selected === null) return all;
  const wanted = new Set(selected);
  return all.filter((column) => column.required || wanted.has(column.field));
}

export const TEMPLATE_GUIDE_HEADERS = [
  "Column",
  "Required",
  "Allowed values",
  "Example",
] as const;

export function templateGuideAoa(
  columns: readonly DriverImportColumnSpec[],
): string[][] {
  return [
    [...TEMPLATE_GUIDE_HEADERS],
    ...columns.map((column) => [
      column.header,
      column.required ? "Required" : "Optional",
      column.allowed,
      column.example,
    ]),
  ];
}
