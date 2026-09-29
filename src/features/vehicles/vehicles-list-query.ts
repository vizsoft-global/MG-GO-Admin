import type { VehicleListRow } from "./types";
import { vehicleIsUnderRepair } from "./vehicle-on-duty";

export const VEHICLE_COLUMN_KINDS = {
  plate: "text",
  chassis: "text",
  kind: "list",
  model: "text",
  year: "range",
  condition: "list",
  chip: "text",
  fuelType: "list",
  fuelCompany: "list",
  carsCompany: "list",
  project: "list",
  typeOfUse: "list",
  location: "text",
  driver: "text",
  empCompany: "list",
  carType: "list",
  replacement: "list",
  repPlate: "text",
  since: "text",
} as const;

export type VehiclesFixedColumn = keyof typeof VEHICLE_COLUMN_KINDS;
export type VehiclesFilterKind = "text" | "list" | "range";
export type VehiclesTextFilter = { contains: string };
export type VehiclesListFilter = { in: string[] };
export type VehiclesRangeFilter = { min: number | null; max: number | null };
export type VehiclesColumnFilter = VehiclesTextFilter | VehiclesListFilter | VehiclesRangeFilter;
export type VehiclesColumnFilters = Record<string, VehiclesColumnFilter>;
export type VehiclesSortDir = "asc" | "desc";
export type VehiclesSort = { key: string; dir: VehiclesSortDir };

export const DEFAULT_VEHICLES_SORT: VehiclesSort = { key: "plate", dir: "asc" };

export function isVehiclesFilterColumn(key: string): key is VehiclesFixedColumn {
  return key in VEHICLE_COLUMN_KINDS;
}

export function vehiclesFilterKind(key: string): VehiclesFilterKind | null {
  return isVehiclesFilterColumn(key) ? VEHICLE_COLUMN_KINDS[key] : null;
}

export function isTextFilter(f: VehiclesColumnFilter | undefined): f is VehiclesTextFilter {
  return Boolean(f && "contains" in f);
}

export function isListFilter(f: VehiclesColumnFilter | undefined): f is VehiclesListFilter {
  return Boolean(f && "in" in f);
}

export function isRangeFilter(f: VehiclesColumnFilter | undefined): f is VehiclesRangeFilter {
  return Boolean(f && ("min" in f || "max" in f));
}

export function isFilterActive(f: VehiclesColumnFilter | undefined): boolean {
  if (!f) return false;
  if (isTextFilter(f)) return f.contains.trim() !== "";
  if (isListFilter(f)) return f.in.length > 0;
  return f.min != null || f.max != null;
}

export function countActiveFilters(filters: VehiclesColumnFilters): number {
  return Object.values(filters).filter(isFilterActive).length;
}

export function withColumnFilter(
  filters: VehiclesColumnFilters,
  column: string,
  next: VehiclesColumnFilter | null,
): VehiclesColumnFilters {
  const copy = { ...filters };
  if (next && isFilterActive(next)) copy[column] = next;
  else delete copy[column];
  return copy;
}

export function nextSort(current: VehiclesSort, column: string): VehiclesSort {
  if (current.key !== column) return { key: column, dir: "asc" };
  if (current.dir === "asc") return { key: column, dir: "desc" };
  return DEFAULT_VEHICLES_SORT;
}

function cellText(row: VehicleListRow, column: VehiclesFixedColumn): string {
  switch (column) {
    case "plate":
      return row.reg_number ?? "";
    case "chassis":
      return row.chassis_no ?? "";
    case "kind":
      return row.vehicle_type_key;
    case "model":
      return row.model ?? "";
    case "year":
      return row.model_year != null ? String(row.model_year) : "";
    case "condition":
      return row.condition ?? "";
    case "chip":
      return row.chip_no ?? "";
    case "fuelType":
      return row.fuel_type ?? "";
    case "fuelCompany":
      return row.fuel_company ?? "";
    case "carsCompany":
      return row.owner_partner_name ?? "";
    case "project":
      return row.assigned_project_key ?? "";
    case "typeOfUse":
      return row.type_of_use ?? "";
    case "location":
      return row.location_text ?? "";
    case "driver":
      return [row.assigned_driver_name, row.assigned_employee_id, row.assigned_driver_code]
        .filter(Boolean)
        .join(" ");
    case "empCompany":
      return row.assigned_partner_name ?? "";
    case "carType":
      return row.car_type ?? "";
    case "replacement":
      return row.replaces_vehicle_id ? "yes" : "no";
    case "repPlate":
      return row.replaces_plate ?? "";
    case "since":
      return row.replacement_started_at ?? "";
  }
}

function cellNumber(row: VehicleListRow, column: VehiclesFixedColumn): number | null {
  if (column === "year") return row.model_year;
  return null;
}

export function rowMatchesColumnFilters(
  row: VehicleListRow,
  filters: VehiclesColumnFilters,
): boolean {
  for (const [column, filter] of Object.entries(filters)) {
    if (!isVehiclesFilterColumn(column) || !isFilterActive(filter)) continue;
    if (isTextFilter(filter)) {
      if (!cellText(row, column).toLowerCase().includes(filter.contains.trim().toLowerCase())) {
        return false;
      }
    } else if (isListFilter(filter)) {
      if (!filter.in.includes(cellText(row, column))) return false;
    } else if (isRangeFilter(filter)) {
      const n = cellNumber(row, column);
      if (n == null) return false;
      if (filter.min != null && n < filter.min) return false;
      if (filter.max != null && n > filter.max) return false;
    }
  }
  return true;
}

export function sortVehicles(rows: VehicleListRow[], sort: VehiclesSort): VehicleListRow[] {
  if (!isVehiclesFilterColumn(sort.key)) return rows;
  const key = sort.key;
  const dir = sort.dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (key === "year") {
      const an = a.model_year ?? -1;
      const bn = b.model_year ?? -1;
      return (an - bn) * dir;
    }
    return cellText(a, key).localeCompare(cellText(b, key), undefined, { numeric: true }) * dir;
  });
}

export function uniqueColumnValues(
  rows: readonly VehicleListRow[],
  column: VehiclesFixedColumn,
): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = cellText(row, column);
    if (value) seen.add(value);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function vehicleMatchesUnderRepairFilter(
  row: Pick<VehicleListRow, "status" | "condition">,
  statusFilter: string,
): boolean {
  if (statusFilter === "under_repair") return vehicleIsUnderRepair(row);
  return true;
}
