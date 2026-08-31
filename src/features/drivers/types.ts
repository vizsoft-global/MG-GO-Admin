export const DOCUMENT_TYPES = [
  "license",
  "civil_id",
  "work_permit",
  "passport",
] as const;

export type DriverDocumentType = (typeof DOCUMENT_TYPES)[number];

export const DEFAULT_NOTIFY_LEAD_DAYS = [30, 14, 7, 1] as const;

export type DocumentExpiryConfig = {
  trackExpiry: boolean;
  expiresAt: string | null;
  notifyEnabled: boolean;
  notifyLeadDays: number[];
  objectKey?: string | null;
};

export const EMPTY_DOCUMENT_EXPIRY: DocumentExpiryConfig = {
  trackExpiry: false,
  expiresAt: null,
  notifyEnabled: true,
  notifyLeadDays: [...DEFAULT_NOTIFY_LEAD_DAYS],
};

export const ASSET_TYPES = [
  "gps",
  "sim",
  "phone",
  "delivery_bag",
  "helmet",
  "uniform",
] as const;

export type DriverAssetType = (typeof ASSET_TYPES)[number];

/** @deprecated Legacy intake status — use workflow_status + linked */
export type DriverIntakeStatus = "awaiting_app_link" | "linked" | "cancelled";

export const DRIVER_WORKFLOW_STATUSES = ["draft", "pending", "approved"] as const;
export type DriverWorkflowStatus = (typeof DRIVER_WORKFLOW_STATUSES)[number];

export const DRIVER_ACCOUNT_STATUSES = ["active", "suspended", "pending"] as const;
export type DriverAccountStatus = (typeof DRIVER_ACCOUNT_STATUSES)[number];

export const DRIVER_RIDER_CATEGORIES = ["in_house", "outsourced"] as const;
export type DriverRiderCategory = (typeof DRIVER_RIDER_CATEGORIES)[number];

export type DriverIntakeRow = {
  id: string;
  /** Optional contact detail — the app credential is employee ID + passcode. */
  phone: string | null;
  full_name: string;
  civil_id: string | null;
  driver_code: string;
  avatar_url: string | null;
  partner_id: string | null;
  zone_id: string | null;
  vehicle_id: string | null;
  assets_issued: Record<string, boolean>;
  status: DriverIntakeStatus;
  workflow_status: DriverWorkflowStatus;
  linked: boolean;
  linked_profile_id: string | null;
  created_at: string;
  updated_at: string;
};

export type VehicleOption = {
  id: string;
  bike_id: string;
  reg_number: string | null;
  vehicle_type_key?: string | null;
};

export type PartnerOption = {
  id: string;
  name: string;
  logo_url: string | null;
};

export type ZoneOption = {
  id: string;
  name: string;
  code: string;
};

export type RestaurantOption = {
  id: string;
  name: string;
  partner_id: string | null;
  partner_name?: string | null;
  status: "draft" | "published" | "archived";
};

export type PendingDocumentFile = {
  docType: DriverDocumentType;
  file: File;
  previewName: string;
};

export type DriverRemoteDocument = {
  objectKey: string;
  signedUrl: string;
  sizeBytes: number | null;
  contentType: string | null;
  source: "driver" | "intake";
  expiry?: DocumentExpiryConfig;
};

export type DriverAssignMutationResult = {
  error?: string;
  success?: boolean;
  warning?: "driver_has_active_delivery";
};

export type AssignDriverRow = {
  driver_id: string;
  intake_id: string | null;
  name: string;
  driver_code: string;
  phone: string | null;
  avatar_url: string | null;
  is_on_duty: boolean;
  zone_id: string | null;
  zone_name: string | null;
  partner_id: string | null;
  partner_name: string | null;
  restaurant_ids: string[];
  restaurant_names: string[];
  latitude: number | null;
  longitude: number | null;
  last_seen_at: string | null;
  has_in_transit_delivery: boolean;
};

export type DriverRestaurantPin = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  map_link: string | null;
};

export type DriverListRow = {
  id: string;
  driver_code: string;
  employee_id: string | null;
  full_name: string;
  phone: string | null;
  partner_id: string;
  partner_name: string;
  partner_logo_url: string | null;
  zone_id: string;
  zone_name: string;
  restaurant_ids: string[];
  restaurant_names: string[];
  workflow_status: DriverWorkflowStatus;
  linked: boolean;
  linked_profile_id: string | null;
  account_status: DriverAccountStatus;
  is_blocked: boolean;
  blocked_reason: string | null;
  is_on_duty: boolean;
  today_deliveries: number;
  app_passcode: string | null;
  archived_at: string | null;
  avatar_url: string | null;
  avatar_display_url: string | null;
  rider_category: DriverRiderCategory;
  client_id: string | null;
  client_name: string | null;
  custom_fields: Record<string, string | number | boolean | string[] | null>;
};

export type DriverAssignedAsset = {
  catalog_item_id: string;
  name: string;
  code: string;
  icon_key: string;
  image_url: string | null;
  assigned_at: string;
};

export type DriverDetailModel = {
  id: string;
  /** Intake row id for edit/update; null when no intake record exists */
  intake_id: string | null;
  source: "intake" | "driver";
  driver_code: string;
  full_name: string;
  phone: string;
  email: string | null;
  civil_id: string;
  employee_id: string | null;
  nationality: string | null;
  rider_category: DriverRiderCategory;
  client_id: string | null;
  client_name: string | null;
  avatar_url: string | null;
  partner_name: string;
  zone_label: string;
  vehicle_label: string | null;
  partner_id: string | null;
  zone_id: string | null;
  vehicle_id: string | null;
  vehicle_type_key: string | null;
  workflow_status: DriverWorkflowStatus;
  linked: boolean;
  linked_profile_id: string | null;
  base_earnings_kwd: number | null;
  joined_at: string | null;
  assets_issued: Record<string, boolean>;
  assigned_assets: DriverAssignedAsset[];
  restaurant_ids: string[];
  restaurant_names: string[];
  has_published_restaurant: boolean;
  app_passcode: string | null;
  account_status: DriverAccountStatus;
  is_blocked: boolean;
  blocked_reason: string | null;
  blocked_at: string | null;
  login_verification_exempt: boolean;
  archived_at: string | null;
  documents: Partial<Record<DriverDocumentType, DriverRemoteDocument>>;
  custom_fields: Record<string, string | number | boolean | string[] | null>;
  deliveries_today: number;
  deliveries_week: number;
};

export const DRIVER_IMPORT_FIELDS = [
  "full_name",
  "phone",
  "civil_id",
  "employee_id",
  "restaurant_ids",
  "partner_id",
  "zone_id",
  "vehicle_label",
  "nationality",
  "rider_category",
  "client_id",
  "client_name",
  "active",
] as const;

/**
 * Phone and civil ID are deliberately absent: they are optional contact
 * details, so a sheet without those columns is a valid sheet. Employee ID stays
 * because it is half the app credential, and a restaurant because a driver
 * cannot be activated without one.
 */
export const DRIVER_IMPORT_REQUIRED_FIELDS = [
  "full_name",
  "employee_id",
  "restaurant_ids",
] as const;

export type DriverImportRequiredField = (typeof DRIVER_IMPORT_REQUIRED_FIELDS)[number];

export type DriverImportStandardField = (typeof DRIVER_IMPORT_FIELDS)[number];
/** Standard field or `cf:<key>` for custom fields */
export type DriverImportTargetField = DriverImportStandardField | `cf:${string}`;

export type DriverImportPreviewStatus =
  | "ok"
  | "duplicate_phone"
  | "duplicate_civil_id"
  | "duplicate_employee_id"
  | "invalid_phone"
  | "invalid_civil_id"
  | "invalid_employee_id"
  | "invalid_nationality"
  | "invalid_rider_category"
  | "invalid_client_id"
  | "invalid_client_name"
  | "invalid_active"
  | "missing_fields"
  | "unmatched_partner"
  | "unmatched_zone"
  | "unmatched_vehicle"
  | "unmatched_restaurant"
  | "ambiguous_partner"
  | "ambiguous_zone"
  | "ambiguous_restaurant";

export type DriverImportMappedRow = {
  rowIndex: number;
  full_name: string | null;
  phone: string | null;
  civil_id: string | null;
  employee_id: string | null;
  custom_fields: Record<string, string | null>;
  /** Optional partner UUID or unique name from the spreadsheet. */
  partner_id: string | null;
  /** Optional zone UUID, code, or unique name from the spreadsheet. */
  zone_id: string | null;
  vehicle_label: string | null;
  /** Comma-separated restaurant name, restaurant_code, and/or UUID. */
  restaurant_ids: string | null;
  nationality: string | null;
  rider_category: string | null;
  client_id: string | null;
  client_name: string | null;
  /** Raw "yes"/"no" cell asking for this driver to be approved on import. */
  active: string | null;
};

export type DriverImportPreviewRow = Omit<
  DriverImportMappedRow,
  "partner_id" | "zone_id" | "restaurant_ids" | "active"
> & {
  status: DriverImportPreviewStatus;
  partner_id: string | null;
  zone_id: string | null;
  vehicle_id: string | null;
  restaurant_ids: string[];
  restaurant_names: string[];
  partner_name: string | null;
  zone_name: string | null;
  nationality: string | null;
  rider_category: DriverRiderCategory;
  /**
   * Parsed Active cell. `null` means the sheet said nothing, in which case the
   * dialog's own approve toggle decides — so an unmapped column behaves exactly
   * as it did before the column existed.
   */
  active: boolean | null;
  skip?: boolean;
  custom_fields: Record<string, string | null>;
};

export type DriverImportCredential = {
  rowIndex: number;
  full_name: string;
  employee_id: string;
  driver_code: string;
  passcode: string;
  phone: string | null;
  civil_id: string | null;
  partner_name: string | null;
  zone_name: string | null;
  vehicle_label: string | null;
  restaurant_names: string[];
  nationality: string | null;
  rider_category: DriverRiderCategory;
  client_id: string | null;
  client_name: string | null;
  custom_fields: Record<string, string | null>;
};
