/** Mirrors the `esign_request_status` enum. `declined` renders as "Rejected" in Figma. */
export type EsignRequestStatus =
  | "pending"
  | "signed"
  | "expired"
  | "cancelled"
  | "declined";

export type EsignStatusCounts = {
  all: number;
  pending: number;
  signed: number;
  declined: number;
  expired: number;
  cancelled: number;
  /** Signed within the trailing 30 days — the Figma "Signed (30d)" KPI. */
  signedLast30d: number;
  /** Sent within the trailing 30 days — the Figma "Sent (30d)" KPI. */
  sentLast30d: number;
  categories: number;
};

export type EsignListFilters = {
  status?: EsignRequestStatus | null;
  limit?: number;
  offset?: number;
  template_id?: string | null;
  batch_id?: string | null;
};

export type EsignListRow = {
  id: string;
  request_code: string;
  title: string;
  category_key: string | null;
  category_label: string | null;
  driver_id: string;
  driver_name: string;
  driver_code: string;
  status: EsignRequestStatus;
  due_at: string | null;
  screenshot_restricted: boolean;
  /** Equal to `created_at` today — the only inserter sends on insert. */
  sent_at: string;
  /** First time the rider opened the document. */
  viewed_at: string | null;
  declined_at: string | null;
  signed_at: string | null;
  signer_display_name: string | null;
  created_at: string;
  template_id?: string | null;
  template_name?: string | null;
  batch_id?: string | null;
  batch_code?: string | null;
  description?: string | null;
};

export type EsignLocale = "en" | "ar";

export const ESIGN_RESERVED_FIELD_KEYS = [
  "company_name",
  "employee_name",
  "employee_id",
  "driver_code",
  "zone",
  "project",
  "nationality",
] as const;

export type EsignTemplateFieldType = "text" | "textarea" | "number" | "date" | "select";

export type EsignTemplateFieldRow = {
  id: string;
  template_id: string;
  field_key: string;
  label_en: string;
  label_ar: string | null;
  field_type: EsignTemplateFieldType;
  options: string[];
  is_required: boolean;
  sort_order: number;
};

export type EsignTemplateRow = {
  id: string;
  category_key: string;
  name_en: string;
  name_ar: string | null;
  header_en: string;
  header_ar: string;
  body_en: string;
  body_ar: string;
  declaration_en: string;
  declaration_ar: string;
  default_language: EsignLocale;
  is_active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  field_count: number;
};

export type EsignTemplateDetail = EsignTemplateRow & {
  fields: EsignTemplateFieldRow[];
};

export type EsignResolveStatus =
  | "ok"
  | "unknown_id"
  | "archived"
  | "blocked"
  | "ambiguous"
  | "invalid";

export type EsignResolveRow = {
  row_index: number;
  employee_id: string;
  ok: boolean;
  status: EsignResolveStatus;
  driver_id?: string;
  snapshot?: import("./render/esign-placeholders").EsignEmployeeSnapshot;
};

export type EsignBatchStatus = "queued" | "processing" | "completed" | "partial";
export type EsignBatchRowStatus = "pending" | "created" | "failed";

export type EsignBatchRow = {
  id: string;
  batch_code: string;
  template_id: string;
  template_name: string | null;
  title: string;
  language: EsignLocale;
  status: EsignBatchStatus;
  total_count: number;
  created_count: number;
  failed_count: number;
  due_at: string | null;
  source_filename: string | null;
  created_at: string;
};

export type EsignBatchLine = {
  id: string;
  row_index: number;
  employee_id: string | null;
  driver_id: string | null;
  status: EsignBatchRowStatus;
  error: string | null;
  request_id: string | null;
  request_code: string | null;
};

export type EsignDetail = EsignListRow & {
  declaration_accepted_at: string | null;
  signer_meta: Record<string, unknown>;
  document_storage_key: string | null;
  signature_storage_key: string | null;
  sent_by: string | null;
  updated_at: string;
};

export type EsignCategoryRow = {
  id: string;
  key: string;
  label_en: string;
  description: string | null;
  icon_key: string | null;
  screenshot_restricted: boolean;
  is_active: boolean;
  sort_order: number;
  /** Signed requests filed under this category — the Figma SIGNED column. */
  signed_count: number;
};

export type EsignDriverOption = {
  id: string;
  full_name: string;
  driver_code: string;
  employee_id: string | null;
};
