import type { VehicleListRow } from "./types";

export const VEHICLE_LIST_TABS = ["all", "suspended", "on-duty"] as const;
export type VehicleListTab = (typeof VEHICLE_LIST_TABS)[number];

export function parseVehicleListTab(value: string | null | undefined): VehicleListTab {
  if (value === "suspended" || value === "on-duty") return value;
  return "all";
}

export function vehicleMatchesTab(
  row: Pick<VehicleListRow, "status" | "assigned_on_duty">,
  tab: VehicleListTab,
): boolean {
  if (tab === "suspended") return row.status === "suspended";
  if (tab === "on-duty") return row.assigned_on_duty;
  return true;
}

export function vehicleMatchesSearch(row: VehicleListRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    row.bike_id,
    row.reg_number,
    row.assigned_driver_name,
    row.assigned_driver_code,
    row.vehicle_type_label,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
}

export function vehicleListKpis(vehicles: readonly Pick<
  VehicleListRow,
  "status" | "project_type" | "assigned_on_duty"
>[]) {
  return {
    total: vehicles.length,
    onDuty: vehicles.filter((row) => row.assigned_on_duty).length,
    suspended: vehicles.filter((row) => row.status === "suspended").length,
    group: vehicles.filter((row) => row.project_type === "group").length,
    rent: vehicles.filter((row) => row.project_type === "rent").length,
    maintenance: vehicles.filter((row) => row.status === "maintenance").length,
  };
}
