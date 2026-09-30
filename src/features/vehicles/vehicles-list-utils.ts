import {
  parseDriverProjectKey,
  VEHICLE_CAR_TYPES,
  type DriverProjectKey,
} from "@/features/fleet/fleet-labels";
import type { VehicleListRow } from "./types";
import { vehicleIsUnderRepair } from "./vehicle-on-duty";

export const VEHICLE_LIST_TABS = ["all", "suspended", "on-duty"] as const;
export type VehicleListTab = (typeof VEHICLE_LIST_TABS)[number];

export const VEHICLE_PROJECT_FILTERS = ["all", "keeta", "americana"] as const;
export type VehicleProjectFilter = (typeof VEHICLE_PROJECT_FILTERS)[number];

export const VEHICLE_STATUS_FILTERS = ["all", "active", "suspended", "maintenance", "under_repair"] as const;
export type VehicleStatusFilter = (typeof VEHICLE_STATUS_FILTERS)[number];

export const VEHICLE_CAR_TYPE_FILTERS = ["all", ...VEHICLE_CAR_TYPES] as const;
export type VehicleCarTypeFilter = (typeof VEHICLE_CAR_TYPE_FILTERS)[number];

export type VehicleTypeOfUseFilter = "all" | string;

export const VEHICLE_KIND_FILTERS = ["all", "bike", "car"] as const;
export type VehicleKindFilter = (typeof VEHICLE_KIND_FILTERS)[number];

export const VEHICLE_KPI_KEYS = [
  "total",
  "onDuty",
  "suspended",
  "company",
  "rent",
  "underRepair",
  "unassigned",
  "bike",
  "car",
  "active",
  "replacement",
] as const;
export type VehicleKpiKey = (typeof VEHICLE_KPI_KEYS)[number];

export const VEHICLE_ASSIGNMENT_FILTERS = ["all", "unassigned"] as const;
export type VehicleAssignmentFilter = (typeof VEHICLE_ASSIGNMENT_FILTERS)[number];

export const VEHICLE_REPLACEMENT_FILTERS = ["all", "yes"] as const;
export type VehicleReplacementFilter = (typeof VEHICLE_REPLACEMENT_FILTERS)[number];

export type VehicleListFilterState = {
  tab: VehicleListTab;
  status: VehicleStatusFilter;
  carType: VehicleCarTypeFilter;
  typeOfUse: VehicleTypeOfUseFilter;
  kind: VehicleKindFilter;
  search: string;
  project: VehicleProjectFilter;
  assignment: VehicleAssignmentFilter;
  replacement: VehicleReplacementFilter;
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
  if (
    value === "active" ||
    value === "suspended" ||
    value === "maintenance" ||
    value === "under_repair"
  ) {
    return value;
  }
  return "all";
}

export function parseVehicleCarTypeFilter(value: string | null | undefined): VehicleCarTypeFilter {
  if (value === "company" || value === "rent" || value === "maintenance") return value;
  return "all";
}

export function parseVehicleTypeOfUseFilter(value: string | null | undefined): VehicleTypeOfUseFilter {
  const key = value?.trim() ?? "";
  if (!key || key === "all") return "all";
  return key as VehicleTypeOfUseFilter;
}

export function parseVehicleKindFilter(value: string | null | undefined): VehicleKindFilter {
  if (value === "bike" || value === "car") return value;
  return "all";
}

export function vehicleMatchesStatus(
  row: Pick<VehicleListRow, "status" | "condition">,
  filter: VehicleStatusFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "under_repair") return vehicleIsUnderRepair(row);
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

export function parseVehicleAssignmentFilter(
  value: string | null | undefined,
): VehicleAssignmentFilter {
  return value === "unassigned" ? "unassigned" : "all";
}

export function parseVehicleReplacementFilter(
  value: string | null | undefined,
): VehicleReplacementFilter {
  return value === "yes" ? "yes" : "all";
}

export function vehicleMatchesAssignment(
  row: Pick<VehicleListRow, "assigned_driver_id">,
  filter: VehicleAssignmentFilter,
): boolean {
  if (filter === "all") return true;
  return row.assigned_driver_id == null;
}

export function vehicleMatchesReplacement(
  row: Pick<VehicleListRow, "replaces_vehicle_id">,
  filter: VehicleReplacementFilter,
): boolean {
  if (filter === "all") return true;
  return row.replaces_vehicle_id != null;
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
      assignment: "all",
      replacement: "all",
    };
  }
  if (key === "onDuty") return { ...prev, tab: "on-duty" };
  if (key === "suspended") return { ...prev, tab: "all", status: "suspended" };
  if (key === "company") return { ...prev, carType: "company" };
  if (key === "rent") return { ...prev, carType: "rent" };
  if (key === "underRepair") return { ...prev, tab: "all", status: "under_repair" };
  if (key === "unassigned") return { ...prev, assignment: "unassigned" };
  if (key === "bike") return { ...prev, kind: "bike" };
  if (key === "car") return { ...prev, kind: "car" };
  if (key === "active") return { ...prev, tab: "all", status: "active" };
  return { ...prev, replacement: "yes" };
}

export function vehicleKpiSelected(
  key: VehicleKpiKey,
  state: Pick<
    VehicleListFilterState,
    "tab" | "status" | "carType" | "typeOfUse" | "kind" | "assignment" | "replacement"
  >,
): boolean {
  const extrasClear =
    state.status === "all" &&
    state.carType === "all" &&
    state.typeOfUse === "all" &&
    state.kind === "all" &&
    state.assignment === "all" &&
    state.replacement === "all";
  if (key === "total") return state.tab === "all" && extrasClear;
  if (key === "onDuty") return state.tab === "on-duty";
  if (key === "suspended") return state.status === "suspended" || state.tab === "suspended";
  if (key === "company") return state.carType === "company";
  if (key === "rent") return state.carType === "rent";
  if (key === "underRepair") return state.status === "under_repair";
  if (key === "unassigned") return state.assignment === "unassigned";
  if (key === "bike") return state.kind === "bike";
  if (key === "car") return state.kind === "car";
  if (key === "active") return state.status === "active";
  return state.replacement === "yes";
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
  vehicles: readonly Pick<
    VehicleListRow,
    | "status"
    | "car_type"
    | "condition"
    | "assigned_on_duty"
    | "assigned_driver_id"
    | "vehicle_type_key"
    | "replaces_vehicle_id"
  >[],
) {
  return {
    total: vehicles.length,
    onDuty: vehicles.filter((row) => row.assigned_on_duty).length,
    suspended: vehicles.filter((row) => row.status === "suspended").length,
    company: vehicles.filter((row) => row.car_type === "company").length,
    rent: vehicles.filter((row) => row.car_type === "rent").length,
    underRepair: vehicles.filter((row) => vehicleIsUnderRepair(row)).length,
    unassigned: vehicles.filter((row) => row.assigned_driver_id == null).length,
    bike: vehicles.filter((row) => row.vehicle_type_key === "bike").length,
    car: vehicles.filter((row) => row.vehicle_type_key === "car").length,
    active: vehicles.filter((row) => row.status === "active").length,
    replacement: vehicles.filter((row) => row.replaces_vehicle_id != null).length,
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
