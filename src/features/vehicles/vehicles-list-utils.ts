import {
  parseDriverProjectKey,
  VEHICLE_CAR_TYPES,
  VEHICLE_TYPES_OF_USE,
  type DriverProjectKey,
} from "@/features/fleet/fleet-labels";
import type { VehicleListRow } from "./types";

export const VEHICLE_LIST_TABS = ["all", "suspended", "on-duty"] as const;
export type VehicleListTab = (typeof VEHICLE_LIST_TABS)[number];

export const VEHICLE_PROJECT_FILTERS = ["all", "keeta", "americana"] as const;
export type VehicleProjectFilter = (typeof VEHICLE_PROJECT_FILTERS)[number];

export const VEHICLE_STATUS_FILTERS = ["all", "active", "suspended", "maintenance"] as const;
export type VehicleStatusFilter = (typeof VEHICLE_STATUS_FILTERS)[number];

export const VEHICLE_CAR_TYPE_FILTERS = ["all", ...VEHICLE_CAR_TYPES] as const;
export type VehicleCarTypeFilter = (typeof VEHICLE_CAR_TYPE_FILTERS)[number];

export const VEHICLE_TYPE_OF_USE_FILTERS = ["all", ...VEHICLE_TYPES_OF_USE] as const;
export type VehicleTypeOfUseFilter = (typeof VEHICLE_TYPE_OF_USE_FILTERS)[number];

export const VEHICLE_KIND_FILTERS = ["all", "bike", "car"] as const;
export type VehicleKindFilter = (typeof VEHICLE_KIND_FILTERS)[number];

export const VEHICLE_KPI_KEYS = [
  "total",
  "onDuty",
  "suspended",
  "company",
  "rent",
  "underRepair",
] as const;
export type VehicleKpiKey = (typeof VEHICLE_KPI_KEYS)[number];

export type VehicleListFilterState = {
  tab: VehicleListTab;
  status: VehicleStatusFilter;
  carType: VehicleCarTypeFilter;
  typeOfUse: VehicleTypeOfUseFilter;
  kind: VehicleKindFilter;
  search: string;
  project: VehicleProjectFilter;
};

export function parseVehicleListTab(value: string | null | undefined): VehicleListTab {
  if (value === "suspended" || value === "on-duty") return value;
  return "all";
}

export function parseVehicleProjectFilter(value: string | null | undefined): VehicleProjectFilter {
  if (value === "keeta" || value === "americana") return value;
  return "all";
}

export function parseVehicleStatusFilter(value: string | null | undefined): VehicleStatusFilter {
  if (value === "active" || value === "suspended" || value === "maintenance") return value;
  return "all";
}

export function parseVehicleCarTypeFilter(value: string | null | undefined): VehicleCarTypeFilter {
  if (value === "company" || value === "rent" || value === "maintenance") return value;
  return "all";
}

export function parseVehicleTypeOfUseFilter(value: string | null | undefined): VehicleTypeOfUseFilter {
  if (value === "operational" || value === "trainer" || value === "standby") return value;
  return "all";
}

export function parseVehicleKindFilter(value: string | null | undefined): VehicleKindFilter {
  if (value === "bike" || value === "car") return value;
  return "all";
}

export function vehicleMatchesStatus(
  row: Pick<VehicleListRow, "status">,
  filter: VehicleStatusFilter,
): boolean {
  if (filter === "all") return true;
  return row.status === filter;
}

export function vehicleMatchesCarType(
  row: Pick<VehicleListRow, "car_type">,
  filter: VehicleCarTypeFilter,
): boolean {
  if (filter === "all") return true;
  return row.car_type === filter;
}

export function vehicleMatchesTypeOfUse(
  row: Pick<VehicleListRow, "type_of_use">,
  filter: VehicleTypeOfUseFilter,
): boolean {
  if (filter === "all") return true;
  return row.type_of_use === filter;
}

export function vehicleMatchesKind(
  row: Pick<VehicleListRow, "vehicle_type_key">,
  filter: VehicleKindFilter,
): boolean {
  if (filter === "all") return true;
  return row.vehicle_type_key === filter;
}

export function applyVehicleKpi(
  key: VehicleKpiKey,
  prev: VehicleListFilterState,
): VehicleListFilterState {
  if (key === "total") {
    return {
      tab: "all",
      status: "all",
      carType: "all",
      typeOfUse: "all",
      kind: "all",
      search: "",
      project: "all",
    };
  }
  if (key === "onDuty") return { ...prev, tab: "on-duty" };
  if (key === "suspended") return { ...prev, tab: "all", status: "suspended" };
  if (key === "company") return { ...prev, carType: "company" };
  if (key === "rent") return { ...prev, carType: "rent" };
  return { ...prev, tab: "all", status: "maintenance" };
}

export function vehicleKpiSelected(
  key: VehicleKpiKey,
  state: Pick<VehicleListFilterState, "tab" | "status" | "carType" | "typeOfUse" | "kind">,
): boolean {
  const extrasClear =
    state.status === "all" &&
    state.carType === "all" &&
    state.typeOfUse === "all" &&
    state.kind === "all";
  if (key === "total") return state.tab === "all" && extrasClear;
  if (key === "onDuty") return state.tab === "on-duty";
  if (key === "suspended") return state.status === "suspended" || state.tab === "suspended";
  if (key === "company") return state.carType === "company";
  if (key === "rent") return state.carType === "rent";
  return state.status === "maintenance";
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

export function assignedDriverProjectWrite(
  assignedDriverId: string | null | undefined,
  projectKeyRaw: unknown,
): { driverId: string; project_key: DriverProjectKey | null } | null {
  const driverId = typeof assignedDriverId === "string" ? assignedDriverId.trim() : "";
  if (!driverId) return null;
  return {
    driverId,
    project_key: parseDriverProjectKey(projectKeyRaw),
  };
}
