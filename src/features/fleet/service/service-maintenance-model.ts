import type {
  MaintenanceRow,
  MaintenanceScheduleRow,
  MaintenanceSettings,
  MaintenanceStatus,
} from "./types";

/**
 * Fleet-default intervals. These are **provisional**: they are stored in
 * `service_maintenance_settings/current` with `provisional: true` and only an
 * admin pressing "Confirm intervals" clears that flag. Nothing in this file
 * treats them as a business rule — the values come from the document, and this
 * object is only the seed the settings dialog writes when the document is empty.
 */
export const DEFAULT_MAINTENANCE_SETTINGS: MaintenanceSettings = {
  km_interval: 10000,
  day_interval: 180,
  alert_km: 500,
  alert_days: 14,
  provisional: true,
  approved_at: null,
  approved_by: null,
  updated_at: null,
  updated_by: null,
};

export function makeModelKey(
  make: string | null | undefined,
  model: string | null | undefined,
): string {
  return `${make ?? ""} ${model ?? ""}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export type MaintenanceVehicle = {
  id: string;
  plate: string;
  make: string | null;
  model: string | null;
  condition: string | null;
  vehicleTypeKey: string | null;
  zoneName: string | null;
  driverName: string | null;
  currentKm: number | null;
};

export type MaintenanceDoneRecord = {
  id: string;
  vehicleId: string;
  serviceTypeKey: string | null;
  /** Kuwait day `YYYY-MM-DD`. */
  doneDay: string;
  odometerKm: number | null;
};

export type ResolvedSchedule = {
  scope: "vehicle" | "model" | "default";
  serviceTypeKey: string | null;
  serviceTypeLabel: string | null;
  kmInterval: number;
  dayInterval: number;
  alertKm: number;
  alertDays: number;
  provisional: boolean;
};

/** Vehicle-scope beats model-scope beats the fleet defaults. */
export function resolveSchedule(
  vehicle: Pick<MaintenanceVehicle, "id" | "make" | "model">,
  schedules: readonly MaintenanceScheduleRow[],
  settings: MaintenanceSettings,
): ResolvedSchedule {
  const active = schedules.filter((row) => row.is_active);
  const own = active.find((row) => row.scope === "vehicle" && row.vehicle_id === vehicle.id);
  const key = makeModelKey(vehicle.make, vehicle.model);
  const model = key
    ? active.find((row) => row.scope === "model" && row.make_model_key === key)
    : undefined;
  const chosen = own ?? model;
  if (chosen) {
    return {
      scope: own ? "vehicle" : "model",
      serviceTypeKey: chosen.service_type_key || null,
      serviceTypeLabel: chosen.service_type_label,
      kmInterval: chosen.km_interval,
      dayInterval: chosen.day_interval,
      alertKm: chosen.alert_km,
      alertDays: chosen.alert_days,
      provisional: false,
    };
  }
  return {
    scope: "default",
    serviceTypeKey: null,
    serviceTypeLabel: null,
    kmInterval: settings.km_interval,
    dayInterval: settings.day_interval,
    alertKm: settings.alert_km,
    alertDays: settings.alert_days,
    provisional: settings.provisional,
  };
}

function utcMs(day: string): number {
  const [year, month, date] = day.slice(0, 10).split("-").map(Number);
  if (!year || !month || !date) return Number.NaN;
  return Date.UTC(year, month - 1, date);
}

/** Whole days from `from` to `to`; negative when `to` is in the past. */
export function daysBetween(from: string, to: string): number | null {
  const a = utcMs(from);
  const b = utcMs(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

export function addDays(day: string, delta: number): string {
  const base = utcMs(day);
  if (Number.isNaN(base)) return day;
  return new Date(base + delta * 86_400_000).toISOString().slice(0, 10);
}

const STATUS_RANK: Record<Exclude<MaintenanceStatus, "unknown">, number> = {
  normal: 0,
  due_soon: 1,
  due: 2,
  overdue: 3,
};

/** Remaining kilometres → status. Negative is overdue; zero is due today. */
export function kmStatus(remainingKm: number | null, alertKm: number): MaintenanceStatus {
  if (remainingKm == null || !Number.isFinite(remainingKm)) return "unknown";
  if (remainingKm < 0) return "overdue";
  if (remainingKm === 0) return "due";
  if (remainingKm <= Math.max(alertKm, 0)) return "due_soon";
  return "normal";
}

export function timeStatus(remainingDays: number | null, alertDays: number): MaintenanceStatus {
  if (remainingDays == null || !Number.isFinite(remainingDays)) return "unknown";
  if (remainingDays < 0) return "overdue";
  if (remainingDays === 0) return "due";
  if (remainingDays <= Math.max(alertDays, 0)) return "due_soon";
  return "normal";
}

/** The row takes the worse of its two dimensions. */
export function worstStatus(statuses: readonly MaintenanceStatus[]): MaintenanceStatus {
  let worst: MaintenanceStatus = "unknown";
  for (const status of statuses) {
    if (status === "unknown") continue;
    if (worst === "unknown" || STATUS_RANK[status] > STATUS_RANK[worst]) worst = status;
  }
  return worst;
}

export function statusRank(status: MaintenanceStatus): number {
  return status === "unknown" ? -1 : STATUS_RANK[status];
}

export type MaintenanceBuildInput = {
  vehicles: readonly MaintenanceVehicle[];
  doneRecords: readonly MaintenanceDoneRecord[];
  schedules: readonly MaintenanceScheduleRow[];
  settings: MaintenanceSettings;
  /** Kuwait today, `YYYY-MM-DD`. */
  today: string;
};

export function buildMaintenanceRows(input: MaintenanceBuildInput): MaintenanceRow[] {
  const rows: MaintenanceRow[] = [];
  for (const vehicle of input.vehicles) {
    const schedule = resolveSchedule(vehicle, input.schedules, input.settings);
    const baseline = baselineFor(input.doneRecords, vehicle.id, schedule.serviceTypeKey);

    const lastServiceKm = baseline?.odometerKm ?? null;
    const lastServiceDate = baseline?.doneDay ?? null;
    const currentKm = vehicle.currentKm;

    const nextDueKm =
      lastServiceKm != null && Number.isFinite(lastServiceKm)
        ? lastServiceKm + schedule.kmInterval
        : null;
    const remainingKm =
      nextDueKm != null && currentKm != null ? currentKm - nextDueKm : null;
    const nextDueDate = lastServiceDate ? addDays(lastServiceDate, schedule.dayInterval) : null;
    const remainingDays = nextDueDate ? daysBetween(input.today, nextDueDate) : null;
    const daysSinceService = lastServiceDate ? daysBetween(lastServiceDate, input.today) : null;

    const byKm = kmStatus(remainingKm, schedule.alertKm);
    const byTime = timeStatus(remainingDays, schedule.alertDays);

    rows.push({
      vehicleId: vehicle.id,
      plate: vehicle.plate,
      model: vehicle.model,
      condition: vehicle.condition,
      vehicleTypeKey: vehicle.vehicleTypeKey,
      zoneName: vehicle.zoneName,
      driverName: vehicle.driverName,
      currentKm,
      lastServiceKm,
      lastServiceDate,
      nextDueKm,
      remainingKm,
      daysSinceService,
      nextDueDate,
      remainingDays,
      status: worstStatus([byKm, byTime]),
      byKm,
      byTime,
      provisional: schedule.provisional,
      serviceTypeLabel: schedule.serviceTypeLabel,
      scheduleScope: schedule.scope,
    });
  }
  return rows.sort(
    (a, b) => statusRank(b.status) - statusRank(a.status) || a.plate.localeCompare(b.plate),
  );
}

export type MaintenanceCounts = Record<MaintenanceStatus, number>;

export function maintenanceCounts(rows: readonly MaintenanceRow[]): MaintenanceCounts {
  const counts: MaintenanceCounts = {
    normal: 0,
    due_soon: 0,
    due: 0,
    overdue: 0,
    unknown: 0,
  };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}


/**
 * The latest **Done** record for the vehicle. `new`, `running` and `cancelled`
 * rows never reach this function — the caller filters on `stage`, and this is
 * the one place a baseline kilometre or date can come from.
 */
export function baselineFor(
  records: readonly MaintenanceDoneRecord[],
  vehicleId: string,
  serviceTypeKey: string | null,
): MaintenanceDoneRecord | null {
  let best: MaintenanceDoneRecord | null = null;
  for (const record of records) {
    if (record.vehicleId !== vehicleId) continue;
    if (serviceTypeKey && record.serviceTypeKey !== serviceTypeKey) continue;
    if (!best || record.doneDay > best.doneDay) best = record;
  }
  return best;
}
