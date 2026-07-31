export type PerformanceHubTab = "period" | "live";

export type PerformanceSortKey =
  | "overall_desc"
  | "overall_asc"
  | "delivery_desc"
  | "delivery_asc"
  | "utilization_desc"
  | "utilization_asc"
  | "compliance_desc"
  | "compliance_asc"
  | "name_asc"
  | "name_desc";

export type PerformanceScoreWeights = {
  delivery: number;
  utilization: number;
  compliance: number;
  exception_penalty: number;
};

export const DEFAULT_PERFORMANCE_WEIGHTS: PerformanceScoreWeights = {
  delivery: 1,
  utilization: 1,
  compliance: 1,
  exception_penalty: 5,
};

export type PerformanceListFilters = {
  search?: string;
  partnerId?: string;
  zoneId?: string;
  restaurantId?: string;
  driverStatus?: string;
  fromDate?: string;
  toDate?: string;
  sort?: PerformanceSortKey;
  page?: number;
  pageSize?: number;
  driverId?: string;
};

export type PerformanceExceptionSummary = {
  exception_type: string;
  exception_date: string;
  severity: string;
  resolution_status: string | null;
};

export type PerformanceDriverRow = {
  driver_id: string;
  driver_code: string;
  employee_id: string | null;
  driver_name: string;
  driver_phone: string;
  driver_status: string;
  partner_id: string | null;
  partner_name: string | null;
  zone_id: string | null;
  zone_name: string | null;
  is_on_duty: boolean;
  worked_days: number;
  leave_days: number;
  absent_days: number;
  eligible_days: number;
  period_days: number;
  actual_deliveries: number;
  target_deliveries: number;
  rule_id: string | null;
  incentive_period: string | null;
  rule_target: number;
  delivery_efficiency: number;
  delivery_efficiency_raw: number;
  utilization: number;
  compliance_score: number;
  exception_count: number;
  exceptions: PerformanceExceptionSummary[];
  overall_score: number;
};

export type PerformanceKpis = {
  avg_overall: number | null;
  avg_delivery_pct: number | null;
  avg_utilization_pct: number | null;
  avg_compliance: number | null;
  below_threshold: number;
};

export type PerformanceListResult = {
  rows: PerformanceDriverRow[];
  totalCount: number;
  kpis: PerformanceKpis;
  weights: PerformanceScoreWeights;
  from: string;
  to: string;
};

export type RecentDeliveryFeedItem = {
  id: string;
  driver_id: string | null;
  driver_name: string;
  driver_code: string;
  status: string;
  partner_name: string | null;
  zone_name: string | null;
  delivered_at: string | null;
  created_at: string;
};
