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
