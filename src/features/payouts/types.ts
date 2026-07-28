export type PayoutRunStatus = "draft" | "approved" | "paid" | "voided";

export type PayoutRunRow = {
  id: string;
  period_start: string;
  period_end: string;
  status: PayoutRunStatus;
  notes: string | null;
  total_drivers: number;
  total_payable_kwd: number;
  created_at: string;
  approved_at: string | null;
  paid_at: string | null;
};

export type DriverPayoutLine = {
  id: string;
  driver_id: string;
  driver_code: string;
  driver_name: string;
  period_start: string;
  period_end: string;
  base_kwd: number;
  incentive_kwd: number;
  loan_deduction_kwd: number;
  penalty_kwd: number;
  reimbursement_kwd: number;
  adjustment_kwd: number;
  net_payable_kwd: number;
  delivery_count: number;
  status: PayoutRunStatus;
  notes: string | null;
  paid_at: string | null;
  breakdown_snapshot: unknown[];
};

export type PayoutRunDetail = {
  run: Record<string, unknown>;
  lines: DriverPayoutLine[];
};
