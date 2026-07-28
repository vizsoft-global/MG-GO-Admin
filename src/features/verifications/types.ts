export const VERIFICATION_STATUSES = [
  "pending",
  "matched",
  "surplus",
  "deficit",
  "conflict",
  "reverted",
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const VERIFICATION_SOURCES = ["manual", "import"] as const;
export type VerificationSource = (typeof VERIFICATION_SOURCES)[number];

export type VerificationListCursor = {
  service_date: string;
  id: string;
} | null;

export type VerificationSortKey =
  | "service_date"
  | "reported_count"
  | "matched_count"
  | "shortfall_count"
  | "status";

export type VerificationSortDir = "asc" | "desc";

export type VerificationTabFilter =
  | "all"
  | "needs_action"
  | "matched"
  | "deficit"
  | "pending";

export type VerificationListFilters = {
  search?: string;
  status?: VerificationStatus | "all";
  tab?: VerificationTabFilter;
  dateFrom?: string;
  dateTo?: string;
  driverId?: string;
  restaurantId?: string;
  partnerId?: string;
  source?: VerificationSource | "all";
  sortBy?: VerificationSortKey;
  sortDir?: VerificationSortDir;
};

export type VerificationListStats = {
  total: number;
  needs_action: number;
  matched: number;
  deficit: number;
  pending: number;
  conflict: number;
  surplus: number;
};

export type VerificationListRow = {
  id: string;
  driver_id: string;
  driver_name: string;
  driver_code: string;
  employee_id: string | null;
  restaurant_id: string;
  restaurant_name: string;
  partner_id: string;
  partner_name: string;
  service_date: string;
  reported_count: number;
  matched_count: number;
  under_review_count: number;
  shortfall_count: number;
  status: VerificationStatus;
  source: VerificationSource;
  notes: string | null;
  reconciled_at: string | null;
  created_at: string;
};

export type VerificationDeliveryRow = {
  id: string;
  short_id: string;
  status: string;
  delivered_at: string | null;
  external_order_id: string | null;
};

export type VerificationDetailModel = VerificationListRow & {
  balance_count: number;
  deliveries: VerificationDeliveryRow[];
};

export type VerificationDriverOption = {
  id: string;
  driver_code: string;
  employee_id: string | null;
  full_name: string;
  partner_id: string | null;
};

export type VerificationImportBatchRow = {
  id: string;
  file_name: string;
  row_count: number;
  applied_count: number;
  skipped_count: number;
  status: "previewed" | "applied" | "reverted";
  uploaded_at: string;
  reverted_at: string | null;
};

export type VerificationExportRestaurantRow = {
  restaurant_id: string;
  restaurant_name: string;
  restaurant_external_id: string | null;
  partner_id: string | null;
  partner_name: string;
  zone_id: string | null;
  zone_name: string;
  status: string;
};

export type VerificationExportZoneRow = {
  zone_id: string;
  zone_name: string;
  zone_code: string;
  restaurant_id: string | null;
  restaurant_name: string;
  restaurant_external_id: string | null;
  partner_id: string | null;
  partner_name: string;
};

export type VerificationExportPartnerRow = {
  partner_id: string;
  partner_name: string;
  restaurant_id: string | null;
  restaurant_name: string;
  restaurant_external_id: string | null;
  zone_id: string | null;
  zone_name: string;
};

export type VerificationExportSampleRow = {
  employee_id: string;
  driver_code: string;
  restaurant_external_id: string;
  restaurant_name: string;
  partner_name: string;
  service_date: string;
  reported_count: number;
  notes: string;
};

export type VerificationExportData = {
  restaurants: VerificationExportRestaurantRow[];
  zones: VerificationExportZoneRow[];
  partners: VerificationExportPartnerRow[];
  sampleImport: VerificationExportSampleRow[];
};

export type VerificationActionError =
  | "not_authorized"
  | "missing_fields"
  | "invalid_count"
  | "driver_not_found"
  | "restaurant_not_found"
  | "duplicate"
  | "save_failed"
  | "delete_failed"
  | "reconcile_failed"
  | "batch_not_found"
  | "batch_already_reverted";

export type ImportPreviewRowStatus =
  | "ok"
  | "duplicate"
  | "unmatched_driver"
  | "unmatched_restaurant"
  | "invalid_date"
  | "invalid_count"
  | "skipped";

export type ImportMappedRow = {
  rowIndex: number;
  employee_id: string | null;
  driver_code: string | null;
  restaurant_external_id: string | null;
  restaurant_name: string | null;
  partner_name: string | null;
  service_date: string | null;
  reported_count: number | null;
  notes: string | null;
};

export type ImportPreviewRow = ImportMappedRow & {
  status: ImportPreviewRowStatus;
  driver_id: string | null;
  driver_name: string | null;
  restaurant_id: string | null;
  restaurant_resolved_name: string | null;
  skip?: boolean;
};

export const IMPORT_TARGET_FIELDS = [
  "employee_id",
  "driver_code",
  "restaurant_external_id",
  "restaurant_name",
  "partner_name",
  "service_date",
  "reported_count",
  "notes",
] as const;

export type ImportTargetField = (typeof IMPORT_TARGET_FIELDS)[number];
