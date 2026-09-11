import type { DriverProjectKey, VehicleFuelCompany, VehicleFuelType } from "@/features/fleet/fleet-labels";

export type FuelFillAttachment = {
  kind: "fuel_receipt" | "fuel_pump" | "odometer" | string;
  title: string;
  file_name: string | null;
  storage_key: string;
  captured_at: string | null;
  source: string | null;
};

export type FuelFillListItem = {
  id: string;
  filled_at: string;
  ymd: string;
  litres: number;
  cost_kwd: number;
  station_name: string;
  lat: number | null;
  lng: number | null;
  driver_id: string;
  driver_name: string | null;
  driver_code: string | null;
  employee_id: string | null;
  employee_company: string | null;
  project_key: DriverProjectKey | null;
  vehicle_id: string;
  plate: string | null;
  kind: string | null;
  model: string | null;
  fuel_type: VehicleFuelType | null;
  fuel_company: VehicleFuelCompany | null;
  chip_no: string | null;
  fuel_monthly_limit_kwd: number | null;
  vehicle_company: string | null;
  zone_name: string | null;
  attachments: FuelFillAttachment[];
};

export type FuelDayCell = {
  costKwd: number;
  litres: number;
  stationName: string;
};

export type FuelWeekRow = {
  key: string;
  driverId: string;
  driverName: string | null;
  employeeId: string | null;
  employeeCompany: string | null;
  vehicleId: string;
  plate: string | null;
  model: string | null;
  vehicleCompany: string | null;
  chip: string | null;
  fuelType: VehicleFuelType | null;
  fuelCompany: VehicleFuelCompany | null;
  projectKey: DriverProjectKey | null;
  zone: string | null;
  monthlyLimit: number;
  withdrawn: number;
  critical: boolean;
  days: Array<FuelDayCell | null>;
  fills: FuelFillListItem[];
};
