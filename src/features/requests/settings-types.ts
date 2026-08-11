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

export type StepTemplateRow = {
  id?: string;
  step_order: number;
  step_name: string;
  role_key: string;
  is_system_auto: boolean;
  allowed_actions: string[];
};

export type ComplaintCategoryRow = {
  id: string;
  key: string;
  label_en: string;
  label_ar: string | null;
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

export type DepartmentMemberRow = {
  id: string;
  department_id: string;
  profile_id: string;
  profile_name: string;
  profile_email: string | null;
  role_title: DepartmentRoleTitle;
  is_active: boolean;
};
