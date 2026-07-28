import type { DriverListRow } from "./types";

export type DriversSortKey =
  | "name_asc"
  | "name_desc"
  | "driver_code_asc"
  | "driver_code_desc"
  | "employee_id_asc"
  | "employee_id_desc"
  | "zone_asc"
  | "zone_desc"
  | "partner_asc"
  | "partner_desc"
  | "deliveries_desc"
  | "deliveries_asc"
  | "status_active_first"
  | "on_duty_first";

export const DRIVERS_SORT_KEYS: DriversSortKey[] = [
  "name_asc",
  "name_desc",
  "driver_code_asc",
  "driver_code_desc",
  "employee_id_asc",
  "employee_id_desc",
  "zone_asc",
  "zone_desc",
  "partner_asc",
  "partner_desc",
  "deliveries_desc",
  "deliveries_asc",
  "status_active_first",
  "on_duty_first",
];

const STATUS_RANK: Record<DriverListRow["account_status"], number> = {
  active: 0,
  pending: 1,
  suspended: 2,
};

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function compareNullableText(a: string | null, b: string | null): number {
  const left = a?.trim() || "\uffff";
  const right = b?.trim() || "\uffff";
  return compareText(left, right);
}

export function sortDrivers(rows: DriverListRow[], sortKey: DriversSortKey): DriverListRow[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    switch (sortKey) {
      case "name_asc":
        return compareText(a.full_name, b.full_name);
      case "name_desc":
        return compareText(b.full_name, a.full_name);
      case "driver_code_asc":
        return compareText(a.driver_code, b.driver_code);
      case "driver_code_desc":
        return compareText(b.driver_code, a.driver_code);
      case "employee_id_asc":
        return compareNullableText(a.employee_id, b.employee_id);
      case "employee_id_desc":
        return compareNullableText(b.employee_id, a.employee_id);
      case "zone_asc":
        return compareText(a.zone_name, b.zone_name);
      case "zone_desc":
        return compareText(b.zone_name, a.zone_name);
      case "partner_asc":
        return compareText(a.partner_name, b.partner_name);
      case "partner_desc":
        return compareText(b.partner_name, a.partner_name);
      case "deliveries_desc":
        return b.today_deliveries - a.today_deliveries;
      case "deliveries_asc":
        return a.today_deliveries - b.today_deliveries;
      case "status_active_first":
        return STATUS_RANK[a.account_status] - STATUS_RANK[b.account_status];
      case "on_duty_first":
        if (a.is_on_duty !== b.is_on_duty) return a.is_on_duty ? -1 : 1;
        return compareText(a.full_name, b.full_name);
      default:
        return 0;
    }
  });
  return sorted;
}

export const DRIVERS_PAGE_SIZE = 100;
