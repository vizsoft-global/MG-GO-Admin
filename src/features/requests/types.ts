export type RequestDatePreset =
  | "today"
  | "tomorrow"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_year"
  | "last_year"
  | "all";

export type RequestListFilters = {
  datePreset: RequestDatePreset;
  status?: string | null;
  type?: string | null;
  search?: string;
  limit?: number;
  offset?: number;
  departmentKey?: string | null;
  zoneId?: string | null;
};

export type RequestDepartmentOption = {
  key: string;
  label: string;
};

export type RequestListRow = {
  id: string;
  request_code: string;
  request_type: string;
  status: string;
  current_step_label: string | null;
  current_step_order: number | null;
  driver_id: string;
  driver_name: string;
  driver_code: string;
  driver_zone: string | null;
  amount_kwd: number | null;
  needs_attention: boolean;
  attention_at: string | null;
  created_at: string;
  severity: string | null;
  awaiting_driver_ack: boolean;
  /** Derived from the current approval step's role, not a column on `requests`. */
  department_key: string | null;
  department_label: string | null;
};

export type RequestKpis = {
  total: number;
  pending: number;
  overdue: number;
  avg_resolution_seconds: number | null;
  prev_total: number | null;
  prev_pending: number | null;
  prev_overdue: number | null;
  prev_avg_resolution_seconds: number | null;
};

export type RequestApprovalStep = {
  id: string;
  step_order: number;
  step_name: string;
  role_key: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  allowed_actions: string[];
  meta: Record<string, unknown>;
  /** When the step became the open one — Figma renders it as "Since 06 Jul". */
  started_at: string | null;
  /** Rider name on step 1, deciding staff member after that. */
  actor_display_name: string | null;
  sla_due_at: string | null;
  sla_breached_at: string | null;
  breach_action: string | null;
};

/** Dates an approver proposes with the `reschedule` action. */
export type RequestRescheduleInput = {
  new_start_date?: string | null;
  new_end_date?: string | null;
};

/** Terms the driver app reads from the last completed step's `meta` (RSup/10b–10d). */
export type RequestDecisionTerms = {
  approved_amount?: number | null;
  approved_tenure_months?: number | null;
  deduction_start_date?: string | null;
  penalty_amount?: number | null;
  required_document?: string | null;
};

export const DECISION_TERM_TYPES = ["loan", "asset", "sick_leave"] as const;

/** Rider picker source for the admin "New request" modal. */
export type RequestDriverOption = {
  id: string;
  full_name: string;
  driver_code: string;
  employee_id: string | null;
  phone: string | null;
};

/**
 * Config the create form needs. `loanTenures` and `complaintCategories` stay empty until the
 * client confirms them — the form must show that instead of inventing options.
 */
export type RequestCreateOptions = {
  drivers: RequestDriverOption[];
  loanTenures: Array<{ months: number; label: string }>;
  complaintCategories: Array<{ key: string; label: string }>;
};

export type RequestCreateInput = {
  driverId: string;
  type: string;
  payload: Record<string, string | number | boolean>;
  amountKwd?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  severity?: string | null;
};

export type RequestClarification = {
  id: string;
  step_order: number | null;
  asked_at: string;
  question: string;
  answered_at: string | null;
  answer: string | null;
};

export type RequestAttachment = {
  id: string;
  storage_key: string;
  file_name: string | null;
  content_type: string | null;
  byte_size: number | null;
  created_at: string;
};

export type RequestRequester = {
  name: string;
  code: string;
  phone: string | null;
  zone: string | null;
};

export type RequestDetail = {
  id: string;
  request_code: string;
  request_type: string;
  status: string;
  payload: Record<string, unknown>;
  current_step_label: string | null;
  current_step_order: number | null;
  driver_id: string;
  requester: RequestRequester | null;
  amount_kwd: number | null;
  start_date: string | null;
  end_date: string | null;
  details: string | null;
  decision_reason: string | null;
  severity: string | null;
  needs_attention: boolean;
  created_at: string;
  completed_at: string | null;
  acknowledged_at: string | null;
  sla_due_at: string | null;
  closed_at: string | null;
};
