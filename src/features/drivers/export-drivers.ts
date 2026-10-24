import { employeeSheetHeader } from "./employee-sheet-columns";
import type { DriverListPageRow, DriverListRow } from "./types";

type ExportRow = DriverListRow & Partial<DriverListPageRow>;

export const DRIVER_EXPORT_COLUMNS = [
  { id: "client_id", pinned: true },
  { id: "employee_id", pinned: true },
  { id: "rider_category", pinned: true },
  { id: "company_client_id", pinned: true },
  { id: "company_name", pinned: true },
  { id: "full_name", pinned: true },
  { id: "phone", pinned: true },
  { id: "restaurants", pinned: true },
  { id: "zone", pinned: true },
  { id: "vehicle", pinned: true },
  { id: "section", pinned: true },
  { id: "partner", pinned: true },
  { id: "employee_status", pinned: true },
  { id: "driver_code", pinned: false },
  { id: "project_key", pinned: false },
  { id: "client_name", pinned: false },
  { id: "account_status", pinned: false },
  { id: "on_duty", pinned: false },
  { id: "today_deliveries", pinned: false },
  { id: "workflow_status", pinned: false },
  { id: "linked", pinned: false },
] as const;

export type DriverExportColumnId = (typeof DRIVER_EXPORT_COLUMNS)[number]["id"];

export const DRIVER_EXPORT_PINNED_IDS = DRIVER_EXPORT_COLUMNS.filter(
  (column) => column.pinned,
).map((column) => column.id);

export const DRIVER_EXPORT_OPTIONAL_IDS = DRIVER_EXPORT_COLUMNS.filter(
  (column) => !column.pinned,
).map((column) => column.id);

const PINNED_EXPORT_IDS = new Set<string>(DRIVER_EXPORT_PINNED_IDS);

export function isPinnedExportColumn(id: string): boolean {
  return PINNED_EXPORT_IDS.has(id);
}

export const APP_CODE_EXPORT_ID = "app_passcode";

export type DriverExportCustomField = { key: string; label: string };

export function customExportColumnId(key: string): string {
  return `custom:${key}`;
}

export function isCustomExportColumnId(id: string): boolean {
  return id.startsWith("custom:");
}

export function resolveExportColumnIds(
  selected: readonly string[],
  customFields: readonly DriverExportCustomField[] = [],
): string[] {
  const allowed = new Set<string>([
    ...DRIVER_EXPORT_COLUMNS.map((column) => column.id),
    ...customFields.map((field) => customExportColumnId(field.key)),
  ]);
  const picked = new Set(selected.filter((id) => allowed.has(id)));
  const catalogIds: string[] = DRIVER_EXPORT_COLUMNS.map((column) => column.id).filter(
    (id) => PINNED_EXPORT_IDS.has(id) || picked.has(id),
  );
  const extra = selected.filter(
    (id) => allowed.has(id) && !catalogIds.includes(id),
  );
  return [...catalogIds, ...extra];
}

function cellValue(
  row: ExportRow,
  columnId: string,
  customFields: readonly DriverExportCustomField[],
): string | number {
  switch (columnId) {
    case "driver_code":
      return row.driver_code;
    case "employee_id":
      return row.employee_id ?? "";
    case "full_name":
      return row.full_name;
    case "phone":
      return row.phone ?? "";
    case "partner":
      return row.partner_name;
    case "zone":
      return row.zone_name;
    case "restaurants":
      return row.restaurant_names.join(", ");
    case "rider_category":
      return row.rider_category;
    case "company_client_id":
      return row.company_client_code ?? "";
    case "company_name":
      return row.company_name ?? row.source_company ?? "";
    case "client_id":
      return row.client_id ?? "";
    case "client_name":
      return row.client_name ?? "";
    case "vehicle":
      return row.vehicle_label ?? "";
    case "section":
      return (row.section_keys ?? []).join(", ");
    case "employee_status":
      return row.employee_status_key ?? "";
    case "project_key":
      return row.project_key ?? "";
    case "account_status":
      return row.is_blocked ? "blocked" : row.account_status;
    case "on_duty":
      return row.is_on_duty ? "yes" : "no";
    case "today_deliveries":
      return row.today_deliveries;
    case "workflow_status":
      return row.workflow_status;
    case "linked":
      return row.linked ? "yes" : "no";
    default: {
      if (!isCustomExportColumnId(columnId)) return "";
      const key = columnId.slice("custom:".length);
      const known = customFields.some((field) => field.key === key);
      if (!known) return "";
      const value = row.custom_fields?.[key];
      return value == null ? "" : String(value);
    }
  }
}

function headerFor(
  columnId: string,
  customFields: readonly DriverExportCustomField[],
): string {
  if (isCustomExportColumnId(columnId)) {
    const key = columnId.slice("custom:".length);
    return customFields.find((field) => field.key === key)?.label ?? key;
  }
  return employeeSheetHeader(columnId);
}

export function buildDriversExportAoa(
  rows: readonly ExportRow[],
  selected: readonly string[],
  options: {
    includeAppCode?: boolean;
    customFields?: readonly DriverExportCustomField[];
  } = {},
): Array<Array<string | number>> {
  const customFields = options.customFields ?? [];
  const columns = resolveExportColumnIds(selected, customFields);
  const headers = columns.map((id) => headerFor(id, customFields));
  if (options.includeAppCode) headers.push(APP_CODE_EXPORT_ID);

  return [
    headers,
    ...rows.map((row) => {
      const values = columns.map((id) => cellValue(row, id, customFields));
      if (options.includeAppCode) {
        values.push(row.archived_at ? "" : (row.app_passcode ?? ""));
      }
      return values;
    }),
  ];
}

function escapeCsvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function driversExportCsv(aoa: Array<Array<string | number>>): string {
  return aoa.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

export function   downloadDriversCsv(aoa: Array<Array<string | number>>): void {
  const blob = new Blob(["\uFEFF" + driversExportCsv(aoa)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `drivers-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
