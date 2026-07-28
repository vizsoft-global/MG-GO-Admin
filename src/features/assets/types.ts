export type AssetCatalogRow = {
  id: string;
  name: string;
  code: string;
  description: string | null;
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

export type AssetMutationResult = {
  error?: string;
  success?: boolean;
  id?: string;
  imageWarning?: string;
};
