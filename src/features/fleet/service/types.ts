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
  /** True for the five scheduled programs; every part row is false. */
  tracks_maintenance: boolean;
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
  /** ISO timestamp of the last reading, so a stale figure is visible. */
  odometer_updated_at: string | null;
  vehicle_type_key: string | null;
  zone_name: string | null;
};

export type OdometerSource = "manual" | "service" | "dashcam" | "baseline" | "rider";

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

/**
 * How wide a rule applies. Resolution is narrowest-first:
 * `vehicle` → `make_model` → `make` → `vehicle_type` → fleet defaults.
 *
 * `model` is the name this shipped under and is still written by nothing; a
 * stored `model` row is read as `make_model` so no old document is orphaned.
 */
export type MaintenanceRuleScope = "vehicle" | "make_model" | "make" | "vehicle_type";

export const MAINTENANCE_RULE_SCOPES: readonly MaintenanceRuleScope[] = [
  "vehicle",
  "make_model",
  "make",
  "vehicle_type",
];

export type MaintenanceScheduleRow = {
  id: string;
  scope: MaintenanceRuleScope;
  vehicle_id: string | null;
  make_model_key: string | null;
  make_key: string | null;
  vehicle_type_key: string | null;
  service_type_key: string;
  service_type_label: string | null;
  /** `0` means the rule does not track this dimension at all. */
  km_interval: number;
  day_interval: number;
  alert_km: number;
  alert_days: number;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export type MaintenanceStatus =
  | "unknown"
  | "normal"
  | "due_soon"
  | "due"
  | "overdue"
  /** A rule applies but there is no record and no reading to count from. */
  | "needs_baseline"
  /** The fleet team opted this vehicle out of this program. */
  | "not_tracked"
  /**
   * The program is scheduled on this vehicle type, but no approved interval
   * covers this vehicle (a make the client did not name). This is a real state
   * with a real action — add a rule — and must never be printed as `Unknown`
   * nor computed from an unapproved default.
   */
  | "no_rule";

export const MAINTENANCE_STATUSES: readonly MaintenanceStatus[] = [
  "normal",
  "due_soon",
  "due",
  "overdue",
  "needs_baseline",
  "no_rule",
  "not_tracked",
  "unknown",
];

/**
 * One vehicle × program row — the unit the maintenance tab, the KPI strip and
 * the Excel export all print. Oil, front tyres, rear tyres, brakes and the bike
 * chain are five separate rows for one vehicle precisely because they must be
 * able to disagree.
 */
export type MaintenanceProgramRow = {
  vehicleId: string;
  plate: string;
  make: string | null;
  model: string | null;
  chassisNo: string | null;
  condition: string | null;
  vehicleTypeKey: string | null;
  zoneName: string | null;
  driverName: string | null;
  currentKm: number | null;
  programKey: string;
  programLabel: string;
  lastServiceKm: number | null;
  lastServiceDate: string | null;
  nextDueKm: number | null;
  remainingKm: number | null;
  daysSinceService: number | null;
  nextDueDate: string | null;
  remainingDays: number | null;
  kmInterval: number;
  dayInterval: number;
  status: MaintenanceStatus;
  byKm: MaintenanceStatus;
  byTime: MaintenanceStatus;
  /** Any tracked dimension still has no record to count from. */
  needsSetup: boolean;
  /** Kilometres decide this program but the vehicle has no reading stored. */
  needsOdometer: boolean;
  /** ISO timestamp of the vehicle's last odometer reading, when one exists. */
  odometerUpdatedAt: string | null;
  provisional: boolean;
  /** `none` means the program is scheduled here but no approved rule covers it. */
  ruleScope: MaintenanceRuleScope | "default" | "none";
  /** Bike-only: metres ridden today from the shift-out ledger. */
  todayMeters: number | null;
};

/** `vehicle_maintenance_exclusions/{vehicleId}_{programKey}`. */
export type MaintenanceExclusion = {
  id: string;
  vehicleId: string;
  programKey: string;
  reason: string | null;
  by: string | null;
  at: string | null;
};

/** `vehicle_day_distance/{vehicleId}_{day}` — the bike's daily GPS ledger. */
export type VehicleDayDistance = {
  id: string;
  vehicleId: string;
  day: string;
  totalMeters: number;
  /** `driverId` → metres, summed over every assignment that day. */
  byDriver: Record<string, number>;
  /** A rider-entered absolute reading, when the app captured one. */
  odometerKm: number | null;
  gpsLedgerKm: number;
};

/**
 * Settings for the dashcam odometer feed. The published vendor spec returns 500
 * from outside their network, so the endpoint shape is configuration rather than
 * a code constant: an operator fills these fields and presses Test connection.
 */
export type OdometerSyncConfig = {
  enabled: boolean;
  base_url: string;
  auth_mode: "headers" | "login";
  app_cid: string;
  /**
   * Whether `SERVICE_ODOMETER_APP_SECRET` is present in the server environment.
   *
   * The secret itself is **never** stored in Firestore and never returned to the
   * browser: it lives in Secret Manager (Cloud Functions) and in the Vercel
   * environment (the panel's Test connection), and this flag is the only thing
   * that travels.
   */
  secret_configured: boolean;
  /** `{plate}` / `{chassis}` are substituted per request when present. */
  vehicles_path: string;
  vehicle_path: string;
  odometer_field: string;
  plate_field: string;
  chassis_field: string;
  last_run_at: string | null;
  last_run_summary: string | null;
};

/**
 * The dashcam feed's empty configuration. It lives here, not beside the reader,
 * because the Settings dialog is a client component and the reader is a server
 * module — a client import of a server module fails the build.
 */
export const DEFAULT_ODOMETER_SYNC_CONFIG: OdometerSyncConfig = {
  enabled: false,
  base_url: "",
  auth_mode: "headers",
  app_cid: "",
  secret_configured: false,
  vehicles_path: "/vehicle/list",
  vehicle_path: "/vehicle/info?plate={plate}",
  odometer_field: "odometer",
  plate_field: "plateNo",
  chassis_field: "vin",
  last_run_at: null,
  last_run_summary: null,
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
