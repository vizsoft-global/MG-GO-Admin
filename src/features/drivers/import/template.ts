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
  /** Always written into the workbook, even on "Required only". */
  pinned: boolean;
  /** What the cell may contain, shown on the Guide sheet. */
  allowed: string;
  example: string;
};

const REQUIRED = new Set<string>(DRIVER_IMPORT_REQUIRED_FIELDS);

/** A driver needs one of these. Neither is required alone; both stay in the sample. */
export const DRIVER_IMPORT_ASSIGNMENT_FIELDS = [
  "zone_id",
  "restaurant_ids",
] as const;

const PINNED = new Set<string>([
  ...DRIVER_IMPORT_REQUIRED_FIELDS,
  ...DRIVER_IMPORT_ASSIGNMENT_FIELDS,
]);

export function isPinnedTemplateField(field: string): boolean {
  return PINNED.has(field);
}

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
 * Company Name capture the full-name mapping.
 */
const STANDARD_COLUMNS: Array<
  Omit<DriverImportColumnSpec, "required" | "pinned"> & {
    field: DriverImportStandardField;
  }
> = [
  {
    field: "full_name",
    header: "Full Name",
    allowed: "Any text.",
    example: "Ahmed Ali",
  },
  {
    field: "employee_id",
    header: "MG ID",
    allowed:
      "Letters and digits, 1 to 100 characters. Unique — this is half the app login. Used to match an existing driver on Update. Client ID is a second match key when MG ID is blank.",
    example: "EMP2048",
  },
  {
    field: "client_id",
    header: "Client ID",
    allowed:
      "Any text up to 64 characters. Riders on one platform contract may share it. Unique Client ID matches an existing rider when MG ID is blank. Two people with the same Client ID need MG ID. `-` clears.",
    example: "105913",
  },
  {
    field: "zone_id",
    header: "Zone",
    allowed:
      "Zone name, code, or UUID from the Zones sheet. A new rider needs a zone or a restaurant. On an update, a blank cell keeps the stored zone. `-` clears it.",
    example: "Hawally",
  },
  {
    field: "restaurant_ids",
    header: "Restaurant",
    allowed:
      "Restaurant name, RST code, or UUID. Separate several with commas. See the Restaurants sheet. A new rider needs a zone or a restaurant. On an update, a blank cell keeps the stored restaurants. `-` clears them.",
    example: "KFC FAHAHEEL",
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
    allowed: "12 digits. Must be unique when filled. On an update, this column alone is enough — blank Zone and Restaurant keep the stored assignment.",
    example: "281010100001",
  },
  {
    field: "partner_id",
    header: "Project",
    allowed: "Project name or UUID. See the Partners sheet.",
    example: "",
  },
  {
    field: "vehicle_label",
    header: "Vehicle",
    allowed:
      "Bike ID or registration number of an existing vehicle. An unmatched value blocks that row. `-` clears the link. A blank cell on update leaves the stored vehicle.",
    example: "BIKE-1024",
  },
  {
    field: "vehicle_type",
    header: "Vehicle Type",
    allowed:
      "bike or car (bike | motorcycle | scooter | motor, car | van | truck are accepted). Blank on update leaves the stored type. `-` clears it. A missing column is not written.",
    example: "bike",
  },
  {
    field: "nationality_category_keys",
    header: "Nationality",
    allowed: "A nationality from Settings → Nationality, e.g. Indian, Filipino, Nepalese.",
    example: "Indian",
  },
  {
    field: "rider_category",
    header: "Rider Category",
    allowed: "in_house or outsourced. Blank means in_house.",
    example: "in_house",
  },
  {
    field: "source_company",
    header: "Company Name",
    allowed:
      "Company name or its Client ID, from the Companies sheet. In-house riders always belong to the system company; leave blank. Outsourced: blank means Unassigned. The company's Client ID is derived, not entered.",
    example: "",
  },
  {
    field: "client_name",
    header: "Platform",
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
  {
    field: "off_days",
    header: "Number of OFFs",
    allowed:
      "Whole number of OFF days for the current Kuwait month (0 up to the days in that month). Blank leaves the default of 2 and writes nothing. The rider must be approved on this import or already linked.",
    example: "3",
  },
  { field: "passport_number", header: "Passport", allowed: "Passport number, or `-` to clear. Blank on update leaves the stored value.", example: "P1234567" },
  { field: "nationality", header: "Country", allowed: "Country name or ISO code.", example: "India" },
  { field: "employee_status_key", header: "Employee Status", allowed: "A status from the employee catalog, e.g. running. A blank cell is skipped and does not fail the row. `-` clears.", example: "running" },
  { field: "section_keys", header: "Employee Category", allowed: "Section names, comma-separated. A blank cell is skipped. `-` clears every section.", example: "" },
  { field: "project_key", header: "Project key", allowed: "A project key such as keeta or americana. `-` clears.", example: "" },
  { field: "accommodation", header: "Accommodation", allowed: "Free text. `-` clears.", example: "" },
  { field: "work_start_date", header: "Work Start", allowed: "Date YYYY-MM-DD or DD-MM-YYYY. Stored as work_start_date. `-` clears.", example: "2024-01-15" },
  { field: "screenshots_allowed", header: "Screenshots", allowed: "yes or no. `-` turns the flag off.", example: "no" },
  { field: "login_verification_exempt", header: "Login Exempt", allowed: "yes or no.", example: "no" },
  { field: "bank_code", header: "Bank", allowed: "Bank code or name, or cash. `-` clears the whole bank record.", example: "cash" },
  { field: "account_number", header: "Account Number", allowed: "6 to 20 digits. Cleared automatically when the bank is cash.", example: "" },
  { field: "iban", header: "IBAN", allowed: "Kuwait IBAN. Cleared automatically when the bank is cash.", example: "" },
  { field: "beneficiary_civil_id", header: "Beneficiary Civil ID", allowed: "12 digits.", example: "" },
  { field: "currency", header: "Currency", allowed: "A payment currency code such as KWD. Blank with a bank defaults to KWD.", example: "KWD" },
  { field: "license_expiry", header: "License Expiry", allowed: "Date. `-` stops tracking and keeps the uploaded file.", example: "2027-01-01" },
  { field: "civil_id_expiry", header: "Civil ID Expiry", allowed: "Date. `-` stops tracking and keeps the uploaded file.", example: "" },
  { field: "work_permit_expiry", header: "Work Permit Expiry", allowed: "Date. `-` stops tracking and keeps the uploaded file.", example: "" },
  { field: "passport_expiry", header: "Passport Expiry", allowed: "Date. `-` stops tracking and keeps the uploaded file.", example: "" },
  { field: "health_card_expiry", header: "Health Card Expiry", allowed: "Date. `-` stops tracking and keeps the uploaded file.", example: "" },
  { field: "operations_card_expiry", header: "Operations Card Expiry", allowed: "Date. `-` stops tracking and keeps the uploaded file.", example: "" },
  { field: "sponsorship_key", header: "Sponsorship", allowed: "A sponsorship from Settings. `-` clears.", example: "" },
  { field: "job_position", header: "Job Position", allowed: "rider or light_driver.", example: "rider" },
  { field: "hiring_type", header: "Hiring Type", allowed: "overseas, old_local, new_local, or outsourcing_partner.", example: "new_local" },
  { field: "job_end_date", header: "Job End Date", allowed: "Date YYYY-MM-DD. `-` clears.", example: "" },
  { field: "job_end_description", header: "Job End Description", allowed: "end_of_contract, issue_maker, not_willing_to_continue, or travelled_not_returned.", example: "" },
  { field: "residency_expiry_date", header: "Residency Expiry", allowed: "Date. `-` clears.", example: "" },
  { field: "fixed_salary", header: "Fixed Salary", allowed: "Non-negative amount, up to 3 decimals.", example: "120.000" },
  { field: "work_permit_salary", header: "Work Permit Salary", allowed: "Non-negative amount, up to 3 decimals.", example: "90.000" },
  { field: "last_increment_date", header: "Last Increment", allowed: "Date. `-` clears.", example: "" },
  { field: "asset_ids", header: "Assets", allowed: "Asset catalog names or codes, comma-separated. `-` returns every assigned asset. A blank cell leaves assignments alone.", example: "" },
];

export const DRIVER_IMPORT_COLUMNS: readonly DriverImportColumnSpec[] =
  STANDARD_COLUMNS.map((column) => ({
    ...column,
    required: REQUIRED.has(column.field),
    pinned: PINNED.has(column.field),
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
    pinned: false,
    allowed: describeCustomField(column),
    example: exampleCustomField(column),
  };
}

/**
 * Resolve the operator's tick boxes into the columns the workbook will carry.
 *
 * `selected` of `null` means "no choice expressed" and yields every column,
 * which is what keeps a plain download of the template complete. Pinned
 * columns (identity + zone + restaurant) are always present — a template
 * that cannot be imported is not a template.
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
  return all.filter((column) => column.pinned || wanted.has(column.field));
}

/** Sample cells for zone and restaurant come from the live lists when one exists. */
export function applyTemplateExamples(
  columns: readonly DriverImportColumnSpec[],
  examples: { restaurant?: string; zone?: string },
): DriverImportColumnSpec[] {
  return columns.map((column) => {
    if (column.field === "restaurant_ids" && examples.restaurant) {
      return { ...column, example: examples.restaurant };
    }
    if (column.field === "zone_id" && examples.zone) {
      return { ...column, example: examples.zone };
    }
    return column;
  });
}

export function guideRequiredLabel(column: DriverImportColumnSpec): string {
  if (column.required) return "Required";
  if (column.field === "zone_id") return "If no restaurant";
  if (column.field === "restaurant_ids") return "If no zone";
  return "Optional";
}

/**
 * Drivers sheet: header plus two example rows so the download shows the
 * same rule as Add / Edit — restaurant-only and zone-only are both legal.
 */
export function templateDriversAoa(
  columns: readonly DriverImportColumnSpec[],
  assignmentExamples: { zone?: string; restaurant?: string } = {},
): string[][] {
  const restaurantExample =
    assignmentExamples.restaurant ||
    columns.find((column) => column.field === "restaurant_ids")?.example ||
    "";
  const zoneExample =
    assignmentExamples.zone ||
    columns.find((column) => column.field === "zone_id")?.example ||
    "";

  const restaurantOnly = columns.map((column) => {
    if (column.field === "zone_id") return "";
    if (column.field === "restaurant_ids") return restaurantExample;
    return column.example;
  });

  const zoneOnly = columns.map((column) => {
    if (column.field === "restaurant_ids") return "";
    if (column.field === "zone_id") return zoneExample;
    if (column.field === "full_name") return "Sara Hassan";
    if (column.field === "employee_id") return "EMP2049";
    if (column.field === "phone") return "";
    if (column.field === "civil_id") return "";
    if (column.field === "off_days") return "";
    return column.example;
  });

  return [columns.map((column) => column.header), restaurantOnly, zoneOnly];
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
      guideRequiredLabel(column),
      column.allowed,
      column.example,
    ]),
  ];
}
