/** Row order mirrors the Figma "Request types & fields" and access drawer frames. */
export const REQUEST_TYPE_SLUGS = [
  "leave",
  "loan",
  "asset",
  "fuel",
  "complaint",
  "document",
  "sick_leave",
  "salary_justification",
] as const;

export type RequestTypeSlug = (typeof REQUEST_TYPE_SLUGS)[number];

export const STEP_ALLOWED_ACTIONS = [
  "approve",
  "reject",
  "reschedule",
  "request_documents",
  "attach_send",
  "send_response",
  "escalate",
  "attach_breakdown",
] as const;

export type StepAllowedAction = (typeof STEP_ALLOWED_ACTIONS)[number];

export const SLA_HOUR_OPTIONS = [4, 8, 24, 48, 72] as const;

export type StepBreachAction = "notify" | "escalate";

export type StepTemplateRow = {
  id?: string;
  step_order: number;
  step_name: string;
  role_key: string;
  is_system_auto: boolean;
  allowed_actions: string[];
  sla_minutes: number | null;
  breach_action: StepBreachAction | null;
};

export type ComplaintCategoryRow = {
  id: string;
  key: string;
  label_en: string;
  label_ar: string | null;
  is_active: boolean;
  sort_order: number;
};

export type LoanTenureOptionRow = {
  id: string;
  months: number;
  label: string | null;
  is_active: boolean;
  sort_order: number;
};

export type StaffAccessRow = {
  id: string;
  profile_id: string;
  profile_name: string;
  profile_email: string | null;
  request_type: string;
  access_level: "view_only" | "approver";
};

/** profile_id → department label, used by the Roles & access rights table. */
export type StaffDepartmentMap = Record<string, string>;

export type StaffProfileOption = {
  id: string;
  full_name: string;
  email: string | null;
};

export type RequestTypeScreenshotPolicyRow = {
  request_type: RequestTypeSlug;
  screenshot_restricted: boolean;
  is_active: boolean;
};

/** Widget the driver app renders for a field. Mirrors the DB check constraint. */
export const REQUEST_FIELD_KINDS = [
  "text",
  "textarea",
  "number",
  "date",
  "month",
  "select",
  "multiselect",
  "checkbox",
  "file",
] as const;

export type RequestFieldKind = (typeof REQUEST_FIELD_KINDS)[number];

/**
 * Where the submitted value is stored. `payload` is a key in `requests.payload`;
 * the rest are real columns, which is what makes a value filterable in the admin list.
 */
export const REQUEST_FIELD_TARGETS = [
  "payload",
  "amount_kwd",
  "start_date",
  "end_date",
  "details",
  "severity",
  "attachments",
] as const;

export type RequestFieldTarget = (typeof REQUEST_FIELD_TARGETS)[number];

export const REQUEST_FIELD_OPTION_SOURCES = [
  "static",
  "loan_tenure_options",
  "complaint_categories",
] as const;

export type RequestFieldOptionSource = (typeof REQUEST_FIELD_OPTION_SOURCES)[number];

export const REQUEST_TERMINAL_STATUSES = ["approved", "solved"] as const;

export type RequestTerminalStatus = (typeof REQUEST_TERMINAL_STATUSES)[number];

export type RequestTypeDefinitionRow = {
  key: string;
  label_en: string;
  label_ar: string | null;
  icon_key: string | null;
  /** Built-in type: field set is locked because installed app builds render it from Dart. */
  is_system: boolean;
  is_active: boolean;
  sort_order: number;
  screenshot_restricted: boolean;
  terminal_status_on_approve: RequestTerminalStatus;
  requires_driver_ack_on_approve: boolean;
  date_range_required: boolean;
  min_attachments: number;
  attachments_error_code: string | null;
  field_count: number;
  step_count: number;
  request_count: number;
};

export type RequestFieldDefinitionRow = {
  id?: string;
  field_key: string;
  label_en: string;
  label_ar: string | null;
  kind: RequestFieldKind;
  target: RequestFieldTarget;
  is_required: boolean;
  is_server_required: boolean;
  sort_order: number;
  options_source: RequestFieldOptionSource | null;
  options: string[];
  help_en: string | null;
};

/**
 * Codes the builder actions return that have a translation. Anything else is a raw
 * Postgres message and is shown as-is rather than surfaced as a missing-key string.
 */
export const REQUEST_TYPE_ERROR_CODES = new Set([
  "not_authorized",
  "invalid_key",
  "invalid_field_key",
  "duplicate_field_key",
  "label_required",
  "key_exists",
  "invalid_kind",
  "invalid_target",
  "invalid_options_source",
  "invalid_terminal_status",
  "invalid_min_attachments",
  "options_required",
  "type_in_use",
  "system_type_undeletable",
  "system_type_fields_locked",
]);

export type RequestTypeInput = {
  key: string;
  label_en: string;
  label_ar: string | null;
  icon_key: string | null;
  is_active: boolean;
  sort_order: number;
  screenshot_restricted: boolean;
  terminal_status_on_approve: RequestTerminalStatus;
  requires_driver_ack_on_approve: boolean;
  date_range_required: boolean;
  min_attachments: number;
};

export type AccessLevel = "none" | "view_only" | "approver";

export type StaffAccessMatrixRow = {
  profile_id: string;
  profile_name: string;
  profile_email: string | null;
  access: Partial<Record<RequestTypeSlug, AccessLevel>>;
};

export type DepartmentRow = {
  id: string;
  key: string;
  label_en: string;
  label_ar: string | null;
  is_active: boolean;
  sort_order: number;
  member_count: number;
};

export type DepartmentRoleTitle = "agent" | "manager";

/** Meta counts shown under each tile on the Settings hub (Figma 12-Settings-Home). */
export type SettingsHubCounts = {
  workflows: number;
  types: number;
  assets: number;
  departments: number;
  roles: number;
  esignCategories: number;
};

/** Appointments summary card on the Reports page (Figma 09-Reports). */
export type AppointmentStatusCounts = {
  accepted: number;
  pending: number;
  rejected: number;
};

/**
 * Department breakdown on the Reports page (Figma 09-Reports). Department is the approval step's
 * `role_key`; `avg_step_seconds` is the time a request waited on that department's own step, not
 * whole-request resolution time.
 */
export type RequestDepartmentReportRow = {
  department_key: string;
  department_label: string;
  requests: number;
  approved: number;
  rejected: number;
  avg_step_seconds: number | null;
};

export type DepartmentMemberRow = {
  id: string;
  department_id: string;
  profile_id: string;
  profile_name: string;
  profile_email: string | null;
  role_title: DepartmentRoleTitle;
  is_active: boolean;
};
