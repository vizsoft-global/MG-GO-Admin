import type { DriverProjectKey } from "@/features/fleet/fleet-labels";
import type { VehicleListRow } from "./types";

export const VEHICLE_LIST_TABS = ["all", "suspended", "on-duty"] as const;
export type VehicleListTab = (typeof VEHICLE_LIST_TABS)[number];

export const VEHICLE_PROJECT_FILTERS = ["all", "keeta", "americana"] as const;
export type VehicleProjectFilter = (typeof VEHICLE_PROJECT_FILTERS)[number];

export function parseVehicleListTab(value: string | null | undefined): VehicleListTab {
  if (value === "suspended" || value === "on-duty") return value;
  return "all";
}

export function parseVehicleProjectFilter(value: string | null | undefined): VehicleProjectFilter {
  if (value === "keeta" || value === "americana") return value;
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

export function vehicleMatchesProject(
  row: Pick<VehicleListRow, "assigned_project_key">,
  filter: VehicleProjectFilter,
): boolean {
  if (filter === "all") return true;
  return row.assigned_project_key === filter;
}

export function vehicleMatchesSearch(row: VehicleListRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    row.bike_id,
    row.reg_number,
    row.chassis_no,
    row.model,
    row.make,
    row.chip_no,
    row.location_text,
    row.owner_partner_name,
    row.replaces_plate,
    row.assigned_driver_name,
    row.assigned_driver_code,
    row.assigned_employee_id,
    row.assigned_partner_name,
    row.vehicle_type_label,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
}

export function vehicleListKpis(
  vehicles: readonly Pick<VehicleListRow, "status" | "car_type" | "assigned_on_duty">[],
) {
  return {
    total: vehicles.length,
    onDuty: vehicles.filter((row) => row.assigned_on_duty).length,
    suspended: vehicles.filter((row) => row.status === "suspended").length,
    company: vehicles.filter((row) => row.car_type === "company").length,
    rent: vehicles.filter((row) => row.car_type === "rent").length,
    underRepair: vehicles.filter((row) => row.status === "maintenance").length,
  };
}

export function isProjectKey(value: string | null | undefined): value is DriverProjectKey {
  return value === "keeta" || value === "americana";
}
