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
  make: string | null;
  model: string | null;
  project_type: VehicleProjectType;
  status: VehicleStatus;
  vehicle_type_key: string;
  vehicle_type_label: string;
  assigned_driver_id: string | null;
  assigned_driver_name: string | null;
  assigned_driver_code: string | null;
  assigned_on_duty: boolean;
  created_at: string;
};
