export type EsignRequestStatus = "pending" | "signed" | "expired" | "cancelled";

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
  signed_at: string | null;
  signer_display_name: string | null;
  created_at: string;
};

export type EsignDetail = EsignListRow & {
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
};

export type EsignDriverOption = {
  id: string;
  full_name: string;
  driver_code: string;
  employee_id: string | null;
};
