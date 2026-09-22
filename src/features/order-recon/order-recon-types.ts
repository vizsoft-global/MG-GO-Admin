export type ReconRowStatus = "match" | "mismatch" | "unresolved" | "app_only";

export type OrderReconKpi = {
  compared: number;
  mismatches: number;
  unresolved: number;
  app_only: number;
  not_using_app?: number;
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
};

export type OrderReconRun = {
  id: string;
  file_name: string;
  from_date: string;
  to_date: string;
  kpi: OrderReconKpi;
  created_at: string;
  rows: OrderReconTableRow[];
};
