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
  amount_kwd: number | null;
  needs_attention: boolean;
  attention_at: string | null;
  created_at: string;
  severity: string | null;
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
  created_at: string;
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
  amount_kwd: number | null;
  start_date: string | null;
  end_date: string | null;
  details: string | null;
  decision_reason: string | null;
  severity: string | null;
  needs_attention: boolean;
  created_at: string;
  completed_at: string | null;
};
