import type { EfficiencyBucket, OpsGranularity, OpsRangePreset } from "./performance-ops-formulas";

export type PerformanceHubTab =
  | "overview"
  | "dpd"
  | "riders"
  | "topbottom"
  | "outsource";

export type OpsSlicers = {
  projectKeys: string[];
  zoneIds: string[];
  vehicleKeys: string[];
  nationalities: string[];
  sourceTypes: string[];
  sourceCompanies: string[];
  restaurantIds: string[];
};

export const EMPTY_OPS_SLICERS: OpsSlicers = {
  projectKeys: [],
  zoneIds: [],
  vehicleKeys: [],
  nationalities: [],
  sourceTypes: [],
  sourceCompanies: [],
  restaurantIds: [],
};

export type OpsBounds = {
  today: string;
  first_delivery_date: string | null;
  span_days: number;
  over_cap: boolean;
};

export type OpsKpis = {
  orders: number;
  orders_prev: number;
  overall_dpd: number | null;
  overall_dpd_prev: number | null;
  avg_dpd_eff: number | null;
  avg_dpd_eff_prev: number | null;
  avg_tgt_eff: number | null;
  avg_tgt_eff_prev: number | null;
  riders: number;
  riders_prev: number;
  active: number;
  active_prev: number;
  working_days: number;
  stores_above: number;
  stores_below: number;
};

export type OpsTrendPoint = {
  bucket: string;
  orders: number;
  working_days: number;
  dpd: number | null;
  dpd_eff: number | null;
  tgt_eff: number | null;
};

export type OpsDimRow = {
  key: string;
  id?: string | null;
  orders: number;
  working_days: number;
  dpd: number | null;
  dpd_eff: number | null;
  tgt_eff: number | null;
  riders: number;
  active_riders?: number;
  bikes?: number;
  cars?: number;
};

export type OpsStoreRow = {
  store_id: string | null;
  store_name: string | null;
  zone_id: string | null;
  zone_name: string | null;
  orders: number;
  working_days: number;
  riders: number;
  active_riders: number;
  store_dpd: number | null;
};

export type OpsRiderRow = {
  driver_id: string;
  name: string;
  employee_id: string | null;
  driver_code: string | null;
  zone_id: string | null;
  zone: string | null;
  vehicle_key: string | null;
  nationality: string | null;
  project_key: string | null;
  store_id: string | null;
  store: string | null;
  source_type: string | null;
  source_company: string | null;
  orders: number;
  working_days: number;
  dpd: number | null;
  target_dpd: number;
  store_dpd: number | null;
  veh_zone_dpd: number | null;
  dpd_eff: number | null;
  tgt_eff: number | null;
  status: "Active" | "Inactive";
};

export type OpsRiderView = OpsRiderRow & {
  display_id: string;
  source: string;
  store_label: string;
  vehicle_label: string;
  nationality_label: string;
  partner_label: string;
  bucket: EfficiencyBucket | null;
};

export type OpsOptions = {
  zones: Array<{ id: string; name: string }>;
  restaurants: Array<{ id: string; name: string }>;
  nationalities: string[];
};

export type OpsSnapshot = {
  from: string;
  to: string;
  prev_from: string;
  prev_to: string;
  target_dpd: number;
  partner_mode: "all" | "americana" | "keeta";
  kpis: OpsKpis;
  trend: OpsTrendPoint[];
  by_vehicle: OpsDimRow[];
  by_zone: OpsDimRow[];
  by_partner: OpsDimRow[];
  by_nationality: OpsDimRow[];
  by_company: OpsDimRow[];
  stores: OpsStoreRow[];
  riders: OpsRiderRow[];
  options: OpsOptions;
};

export type OpsQueryInput = {
  from: string;
  to: string;
  granularity: OpsGranularity;
  slicers: OpsSlicers;
  outsourceOnly: boolean;
};

export type OpsChromeState = {
  preset: OpsRangePreset;
  granularity: OpsGranularity;
  slicers: OpsSlicers;
};

export type TargetDpdRow = {
  id: string;
  month: string;
  target: number;
};
