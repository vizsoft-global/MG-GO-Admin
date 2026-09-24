export type ReconRowStatus = "match" | "mismatch" | "unresolved" | "app_only";

export type OrderReconKpi = {
  compared: number;
  mismatches: number;
  unresolved: number;
  app_only: number;
  not_using_app?: number;
  matched_days?: number;
  sheet_days?: number;
};

export type OrderReconTableRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  restaurant_name: string;
  work_date: string;
  excel_orders: number;
  app_orders: number;
  difference: number;
  status: ReconRowStatus;
  driver_id?: string | null;
  restaurant_id?: string | null;
};

export type OrderReconImportStatus = "applied" | "undone";

export type OrderReconRunSummary = {
  id: string;
  file_name: string;
  from_date: string;
  to_date: string;
  kpi: OrderReconKpi;
  created_at: string;
  status: OrderReconImportStatus;
  undo_seq: number | null;
  redoable: boolean;
};

export type OrderReconRun = OrderReconRunSummary & {
  rows: OrderReconTableRow[];
};
