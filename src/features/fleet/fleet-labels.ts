export const VEHICLE_CAR_TYPES = ["company", "rent", "maintenance"] as const;
export type VehicleCarType = (typeof VEHICLE_CAR_TYPES)[number];

export const VEHICLE_CONDITIONS = ["running", "repair_required", "accident", "standby"] as const;
export type VehicleCondition = (typeof VEHICLE_CONDITIONS)[number];

export const VEHICLE_FUEL_TYPES = ["chip", "card"] as const;
export type VehicleFuelType = (typeof VEHICLE_FUEL_TYPES)[number];

export const VEHICLE_FUEL_COMPANIES = ["mus", "unp", "rscd"] as const;
export type VehicleFuelCompany = (typeof VEHICLE_FUEL_COMPANIES)[number];

export const VEHICLE_TYPES_OF_USE = ["operational", "trainer", "standby"] as const;
export type VehicleTypeOfUse = (typeof VEHICLE_TYPES_OF_USE)[number];

export const DRIVER_PROJECT_KEYS = ["keeta", "americana"] as const;
export type DriverProjectKey = (typeof DRIVER_PROJECT_KEYS)[number];

export function isVehicleCarType(value: string | null | undefined): value is VehicleCarType {
  return VEHICLE_CAR_TYPES.includes(value as VehicleCarType);
}

export function isVehicleCondition(value: string | null | undefined): value is VehicleCondition {
  return VEHICLE_CONDITIONS.includes(value as VehicleCondition);
}

export function isVehicleFuelType(value: string | null | undefined): value is VehicleFuelType {
  return VEHICLE_FUEL_TYPES.includes(value as VehicleFuelType);
}

export function isVehicleFuelCompany(value: string | null | undefined): value is VehicleFuelCompany {
  return VEHICLE_FUEL_COMPANIES.includes(value as VehicleFuelCompany);
}

export function isVehicleTypeOfUse(value: string | null | undefined): value is VehicleTypeOfUse {
  return VEHICLE_TYPES_OF_USE.includes(value as VehicleTypeOfUse);
}

export function isDriverProjectKey(value: string | null | undefined): value is DriverProjectKey {
  return DRIVER_PROJECT_KEYS.includes(value as DriverProjectKey);
}

export function carTypeToProjectType(carType: VehicleCarType | null): "group" | "rent" {
  return carType === "rent" ? "rent" : "group";
}

export function defaultFuelMonthlyLimit(vehicleTypeKey: string): number {
  return vehicleTypeKey === "car" ? 60 : 30;
}

export function formatReplacementSince(
  startedAt: string | null | undefined,
  nowMs = Date.now(),
): string | null {
  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return null;
  const days = Math.max(0, Math.floor((nowMs - start) / 86_400_000));
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export function toKuwaitYmd(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuwait",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function kuwaitYmdToIso(ymd: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return `${ymd}T00:00:00+03:00`;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function formatKuwaitDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuwait",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const month = MONTH_SHORT[Number(get("month")) - 1] ?? "Jan";
  return `${get("day")} ${month} ${get("year")}, ${get("hour")}:${get("minute")}`;
}
