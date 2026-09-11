export type AssetCatalogRow = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  category: string | null;
  penalty_kwd: number | null;
  icon_key: string;
  image_url: string | null;
  total_quantity: number;
  reorder_level: number;
  is_active: boolean;
  assigned_qty: number;
  available_qty: number;
  holder_count: number;
  is_low_stock: boolean;
  created_at: string;
  updated_at: string;
};

export type AssetAssignmentRow = {
  id: string;
  catalog_item_id: string;
  quantity: number;
  status: "assigned" | "returned";
  intake_id: string | null;
  driver_id: string | null;
  assigned_at: string;
  returned_at: string | null;
  assigned_by: string | null;
  assigned_by_name: string | null;
  notes: string | null;
  holder_name: string;
  holder_code: string | null;
  holder_type: "driver" | "intake";
  partner_name: string | null;
};

export type AssetDetailModel = AssetCatalogRow & {
  active_assignments: AssetAssignmentRow[];
  recent_returns: AssetAssignmentRow[];
};

export type AssetCatalogKpis = {
  total_skus: number;
  total_units: number;
  assigned_units: number;
  available_units: number;
  low_stock_count: number;
};

export type DriverFormCatalogItem = {
  id: string;
  name: string;
  code: string;
  icon_key: string;
  image_url: string | null;
  total_quantity: number;
  assigned_qty: number;
  available_qty: number;
  is_selected: boolean;
  is_low_stock: boolean;
};

export const FLEET_ASSET_KPI_CODES = [
  "helmet",
  "vest",
  "fuel_chip",
  "phone_holder",
  "charger",
] as const;
export type FleetAssetKpiCode = (typeof FLEET_ASSET_KPI_CODES)[number];

export const ASSET_ASSIGNMENT_ATTACHMENT_KINDS = [
  "handover_form",
  "handover_photo",
  "receive_form",
  "receive_photo",
] as const;
export type AssetAssignmentAttachmentKind = (typeof ASSET_ASSIGNMENT_ATTACHMENT_KINDS)[number];

export type FleetAssetKpi = {
  code: FleetAssetKpiCode;
  name: string;
  total: number;
  used: number;
  remaining: number;
};

export type FleetAssetAssignmentAttachment = {
  id: string;
  kind: AssetAssignmentAttachmentKind;
  title: string;
  file_name: string | null;
  storage_key: string;
  captured_at: string | null;
  source: string | null;
};

export type FleetAssetAssignmentRow = {
  id: string;
  asset_code: string;
  asset_name: string;
  catalog_code: string;
  quantity: number;
  status: "assigned" | "returned";
  driver_id: string | null;
  driver_name: string;
  employee_id: string | null;
  employee_company: string | null;
  phone: string | null;
  project_key: string | null;
  zone: string | null;
  plate: string | null;
  vehicle_model: string | null;
  vehicle_company: string | null;
  received_at_place: string | null;
  received_by_name: string | null;
  assigned_at: string;
  returned_at: string | null;
  returned_by_name: string | null;
  return_reason: string | null;
  attachments: FleetAssetAssignmentAttachment[];
};

export type AssetMutationResult = {
  error?: string;
  success?: boolean;
  id?: string;
  imageWarning?: string;
};
