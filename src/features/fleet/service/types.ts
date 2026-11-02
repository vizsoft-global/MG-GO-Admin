import type { ServiceCategoryKey } from "./service-types";

/** New → Running → Done, or an open record → Cancelled. Done/Cancelled are terminal. */
export type ServiceStage = "new" | "running" | "done" | "cancelled";

export const SERVICE_STAGES: readonly ServiceStage[] = [
  "new",
  "running",
  "done",
  "cancelled",
];

export type ServicePart = {
  name: string;
  qty: number;
  unit_cost_kwd: number;
  total_kwd: number;
};

export type ServiceStageEvent = {
  stage: ServiceStage;
  at: string;
  by: string | null;
  by_name: string | null;
  note: string | null;
};

export type ServiceVehicleSnapshot = {
  plate: string | null;
  chassis_no: string | null;
  make: string | null;
  model: string | null;
  model_year: number | null;
  car_type: string | null;
};

/** One row of `vehicle_services`, additive fields included. */
export type ServiceRecordRow = {
  id: string;
  vehicle_id: string;
  /** Kuwait day the service happened (ISO string, midnight). */
  serviced_at: string;
  /** Legacy free-text kind. Still readable; the catalog label wins when present. */
  kind: string;
  description: string | null;
  service_type_key: string | null;
  service_type_label: string | null;
  category: ServiceCategoryKey | null;
  stage: ServiceStage;
  driver_id: string | null;
  driver_name: string | null;
  vehicle_snapshot: ServiceVehicleSnapshot | null;
  invoice_no: string | null;
  invoice_date: string | null;
  company: string | null;
  odometer_km: number | null;
  odometer: number | null;
  cost_kwd: number | null;
  vendor: string | null;
  notes: string | null;
  parts: ServicePart[];
  stage_history: ServiceStageEvent[];
  done_at: string | null;
  done_odometer_km: number | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type ServiceTypeRow = {
  key: string;
  label_en: string;
  label_ar: string;
  category: ServiceCategoryKey;
  is_active: boolean;
  sort_order: number;
  created_at: string | null;
  updated_at: string | null;
};

export type ServiceVehicleOption = {
  id: string;
  plate: string;
  chassis_no: string | null;
  make: string | null;
  model: string | null;
  model_year: number | null;
  car_type: string | null;
  company_name: string | null;
  condition: string | null;
  driver_id: string | null;
  driver_name: string | null;
  current_odometer_km: number | null;
  vehicle_type_key: string | null;
  zone_name: string | null;
};

export type OdometerSource = "manual" | "service" | "dashcam";

export type MaintenanceSettings = {
  km_interval: number;
  day_interval: number;
  alert_km: number;
  alert_days: number;
  /** True until an admin presses Confirm intervals. */
  provisional: boolean;
  approved_at: string | null;
  approved_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

export type MaintenanceScheduleRow = {
  id: string;
  scope: "vehicle" | "model";
  vehicle_id: string | null;
  make_model_key: string | null;
  service_type_key: string;
  service_type_label: string | null;
  km_interval: number;
  day_interval: number;
  alert_km: number;
  alert_days: number;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export type MaintenanceStatus = "unknown" | "normal" | "due_soon" | "due" | "overdue";

export const MAINTENANCE_STATUSES: readonly MaintenanceStatus[] = [
  "normal",
  "due_soon",
  "due",
  "overdue",
  "unknown",
];

export type MaintenanceRow = {
  vehicleId: string;
  plate: string;
  model: string | null;
  condition: string | null;
  vehicleTypeKey: string | null;
  zoneName: string | null;
  driverName: string | null;
  currentKm: number | null;
  lastServiceKm: number | null;
  lastServiceDate: string | null;
  nextDueKm: number | null;
  remainingKm: number | null;
  daysSinceService: number | null;
  nextDueDate: string | null;
  remainingDays: number | null;
  status: MaintenanceStatus;
  byKm: MaintenanceStatus;
  byTime: MaintenanceStatus;
  provisional: boolean;
  serviceTypeLabel: string | null;
  scheduleScope: "vehicle" | "model" | "default";
};

/** A record reduced to the fields the report and maintenance models read. */
export type ServiceDoneRecord = {
  id: string;
  vehicleId: string;
  vehiclePlate: string | null;
  serviceTypeKey: string | null;
  serviceTypeLabel: string | null;
  category: ServiceCategoryKey;
  vendor: string | null;
  costKwd: number;
  parts: ServicePart[];
  /** Kuwait day, `YYYY-MM-DD`. */
  doneDay: string;
};
