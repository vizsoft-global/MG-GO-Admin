import type { DriverProjectKey, VehicleCarType, VehicleFuelCompany } from "@/features/fleet/fleet-labels";
import type { FleetQueueRequestType } from "./fleet-request-utils";

export type FleetRequestListRow = {
  id: string;
  request_code: string;
  request_type: FleetQueueRequestType;
  vehicle_id: string | null;
  item: string | null;
  quantity: number | null;
  had_before: boolean | null;
  handover_by: string | null;
  handover_at: string | null;
  status: string;
  current_step_label: string | null;
  department_key: string | null;
  department: "Fleet" | "Accounts" | null;
  driver_id: string;
  driver_name: string;
  employee_id: string | null;
  employee_company: string | null;
  phone: string | null;
  project_key: DriverProjectKey | null;
  zone: string | null;
  plate: string | null;
  vehicle_model: string | null;
  vehicle_company: string | null;
  car_type: VehicleCarType | null;
  fuel_company: VehicleFuelCompany | null;
  amount_kwd: number | null;
  request_no_this_month: number;
  monthly_total_kwd: number;
  created_at: string;
};

export type FleetRequestAttachment = {
  id: string;
  title: string;
  kind: string | null;
  file_name: string | null;
  storage_key: string;
  captured_at: string | null;
  source: string | null;
  created_at: string;
};
