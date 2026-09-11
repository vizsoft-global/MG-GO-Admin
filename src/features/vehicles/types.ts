import type {
  DriverProjectKey,
  VehicleCarType,
  VehicleCondition,
  VehicleFuelCompany,
  VehicleFuelType,
  VehicleTypeOfUse,
} from "@/features/fleet/fleet-labels";

export type VehicleStatus = "active" | "suspended" | "maintenance";
export type VehicleProjectType = "group" | "rent";

export type VehicleTypeRow = {
  key: string;
  label_en: string;
  label_ar: string;
  sort_order: number;
  is_active: boolean;
};

export type VehicleListRow = {
  id: string;
  bike_id: string;
  reg_number: string | null;
  chassis_no: string | null;
  make: string | null;
  model: string | null;
  model_year: number | null;
  project_type: VehicleProjectType;
  status: VehicleStatus;
  vehicle_type_key: string;
  vehicle_type_label: string;
  location_text: string | null;
  condition: VehicleCondition | null;
  car_type: VehicleCarType | null;
  type_of_use: VehicleTypeOfUse | null;
  fuel_type: VehicleFuelType | null;
  fuel_company: VehicleFuelCompany | null;
  chip_no: string | null;
  fuel_monthly_limit_kwd: number | null;
  owner_partner_id: string | null;
  owner_partner_name: string | null;
  replaces_vehicle_id: string | null;
  replacement_started_at: string | null;
  replaces_plate: string | null;
  assigned_driver_id: string | null;
  assigned_driver_name: string | null;
  assigned_driver_code: string | null;
  assigned_employee_id: string | null;
  assigned_driver_phone: string | null;
  assigned_project_key: DriverProjectKey | null;
  assigned_accommodation: string | null;
  assigned_partner_name: string | null;
  assigned_zone_name: string | null;
  assigned_on_duty: boolean;
  created_at: string;
};

export type VehiclePartnerOption = {
  id: string;
  name: string;
};
