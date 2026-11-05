/**
 * Accident Management — the vocabulary an accident case is filed under.
 *
 * Everything here is additive on the existing `vehicle_accidents` ledger. A row
 * written before this module existed has none of these keys and still renders:
 * `parseAccidentRow` (see `accident-model.ts`) maps it to blanks and keeps
 * `severity` / `notes` / `storage_key` exactly as they are stored.
 *
 * Five closed vocabularies. Every one of them is a closed set with an EN/AR
 * label, so the list, the detail page, the filter chips, the KPI cards and the
 * Excel fill all read the same tuple and no screen can invent a sixth value.
 */

/** Close / Pending / Delay — the exact words the client's PDF prints. */
export const ACCIDENT_CASE_STATUSES = ["close", "pending", "delay"] as const;
export type AccidentCaseStatus = (typeof ACCIDENT_CASE_STATUSES)[number];

export const ACCIDENT_CASE_STATUS_LABELS: Record<
  AccidentCaseStatus,
  { en: string; ar: string }
> = {
  close: { en: "Close", ar: "مغلق" },
  pending: { en: "Pending", ar: "قيد الانتظار" },
  delay: { en: "Delay", ar: "متأخر" },
};

/** Green / amber / red, as the client's screenshot prints them. */
export const ACCIDENT_CASE_STATUS_TONE: Record<AccidentCaseStatus, string> = {
  close: "border-emerald-200 bg-emerald-50 text-emerald-700",
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  delay: "border-rose-200 bg-rose-50 text-rose-700",
};

export function isAccidentCaseStatus(value: unknown): value is AccidentCaseStatus {
  return (
    typeof value === "string" &&
    (ACCIDENT_CASE_STATUSES as readonly string[]).includes(value)
  );
}

export function accidentCaseStatusLabel(
  key: AccidentCaseStatus | null | undefined,
  locale: string,
): string {
  const row = key ? ACCIDENT_CASE_STATUS_LABELS[key] : ACCIDENT_CASE_STATUS_LABELS.pending;
  return locale === "ar" ? row.ar || row.en : row.en;
}

/** Yes / No only. The third "under investigation" option was declined by the client. */
export const DRIVER_FAULT_VALUES = ["yes", "no"] as const;
export type DriverFault = (typeof DRIVER_FAULT_VALUES)[number];

export const DRIVER_FAULT_LABELS: Record<DriverFault, { en: string; ar: string }> = {
  yes: { en: "Yes", ar: "نعم" },
  no: { en: "No", ar: "لا" },
};

export function isDriverFault(value: unknown): value is DriverFault {
  return typeof value === "string" && (DRIVER_FAULT_VALUES as readonly string[]).includes(value);
}

export function driverFaultLabel(key: DriverFault | null | undefined, locale: string): string {
  if (!key) return "—";
  const row = DRIVER_FAULT_LABELS[key];
  return locale === "ar" ? row.ar || row.en : row.en;
}

/** What happened to the vehicle *for this case*. Never written to `vehicles`. */
export const VEHICLE_CASE_STATUSES = [
  "in_operation",
  "maintenance_replaced",
  "total_loss_replaced",
  "case_check",
] as const;
export type VehicleCaseStatus = (typeof VEHICLE_CASE_STATUSES)[number];

export const VEHICLE_CASE_STATUS_LABELS: Record<
  VehicleCaseStatus,
  { en: string; ar: string }
> = {
  in_operation: { en: "Vehicle in Operation", ar: "المركبة قيد التشغيل" },
  maintenance_replaced: { en: "In Maintenance & Replaced", ar: "في الصيانة وتم الاستبدال" },
  total_loss_replaced: { en: "Total Loss & Replaced", ar: "تلف كلي وتم الاستبدال" },
  case_check: { en: "Case Check", ar: "فحص الحالة" },
};

export function isVehicleCaseStatus(value: unknown): value is VehicleCaseStatus {
  return (
    typeof value === "string" &&
    (VEHICLE_CASE_STATUSES as readonly string[]).includes(value)
  );
}

export function vehicleCaseStatusLabel(
  key: VehicleCaseStatus | null | undefined,
  locale: string,
): string {
  if (!key) return "—";
  const row = VEHICLE_CASE_STATUS_LABELS[key];
  return locale === "ar" ? row.ar || row.en : row.en;
}

/** The two outcomes that expect a replacement plate on the record. */
export const REPLACEMENT_CASE_STATUSES: readonly VehicleCaseStatus[] = [
  "maintenance_replaced",
  "total_loss_replaced",
];

export const INSURANCE_CLAIM_STATUSES = [
  "none",
  "submitted",
  "pending",
  "approved",
  "rejected",
] as const;
export type InsuranceClaimStatus = (typeof INSURANCE_CLAIM_STATUSES)[number];

export const INSURANCE_CLAIM_STATUS_LABELS: Record<
  InsuranceClaimStatus,
  { en: string; ar: string }
> = {
  none: { en: "None", ar: "لا يوجد" },
  submitted: { en: "Submitted", ar: "تم التقديم" },
  pending: { en: "Pending", ar: "قيد الانتظار" },
  approved: { en: "Approved", ar: "تمت الموافقة" },
  rejected: { en: "Rejected", ar: "مرفوض" },
};

export function isInsuranceClaimStatus(value: unknown): value is InsuranceClaimStatus {
  return (
    typeof value === "string" &&
    (INSURANCE_CLAIM_STATUSES as readonly string[]).includes(value)
  );
}

export function insuranceClaimStatusLabel(
  key: InsuranceClaimStatus | null | undefined,
  locale: string,
): string {
  if (!key) return "—";
  const row = INSURANCE_CLAIM_STATUS_LABELS[key];
  return locale === "ar" ? row.ar || row.en : row.en;
}

export const POLICE_REPORT_STATUSES = [
  "not_filed",
  "filed",
  "received",
  "not_required",
] as const;
export type PoliceReportStatus = (typeof POLICE_REPORT_STATUSES)[number];

export const POLICE_REPORT_STATUS_LABELS: Record<
  PoliceReportStatus,
  { en: string; ar: string }
> = {
  not_filed: { en: "Not filed", ar: "لم يُحرر" },
  filed: { en: "Filed", ar: "تم تحريره" },
  received: { en: "Received", ar: "تم استلامه" },
  not_required: { en: "Not required", ar: "غير مطلوب" },
};

export function isPoliceReportStatus(value: unknown): value is PoliceReportStatus {
  return (
    typeof value === "string" &&
    (POLICE_REPORT_STATUSES as readonly string[]).includes(value)
  );
}

export function policeReportStatusLabel(
  key: PoliceReportStatus | null | undefined,
  locale: string,
): string {
  if (!key) return "—";
  const row = POLICE_REPORT_STATUS_LABELS[key];
  return locale === "ar" ? row.ar || row.en : row.en;
}

/** Who filed it. A rider report starts `pending` and waits for `reviewed_*`. */
export const ACCIDENT_SOURCES = ["admin", "rider"] as const;
export type AccidentSource = (typeof ACCIDENT_SOURCES)[number];

export function isAccidentSource(value: unknown): value is AccidentSource {
  return typeof value === "string" && (ACCIDENT_SOURCES as readonly string[]).includes(value);
}

/** A rider report may carry 1–10 files; an admin entry may carry none. */
export const MAX_ACCIDENT_ATTACHMENTS = 10;
/** Matches the upload rule in `driver-upload-keys.ts` for `accident_attachment`. */
export const MAX_ACCIDENT_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/**
 * Rider object keys live under `drivers/{uid}/accident_attachment/{date}/{uuid}.{ext}`.
 * The admin uploads under `vehicles/{vehicleId}/accidents/...`, which
 * `isR2ObjectKey` already allows.
 */
export const ACCIDENT_ATTACHMENT_FOLDER = "accident_attachment";

export function isRiderAccidentKey(driverId: string, key: string): boolean {
  if (!driverId) return false;
  return key.startsWith(`drivers/${driverId}/${ACCIDENT_ATTACHMENT_FOLDER}/`);
}

export type AccidentAttachmentMeta = {
  key: string;
  file_name: string | null;
  kind: string | null;
  content_type: string | null;
  size: number | null;
  uploaded_by: string | null;
  at: string | null;
};

/** One row of `vehicle_accidents`, additive fields included. */
export type AccidentRow = {
  id: string;
  reference: string | null;
  vehicle_id: string;
  plate_snapshot: string | null;
  vehicle_company_name: string | null;
  model_year: number | null;
  driver_id: string | null;
  driver_name: string | null;
  driver_code: string | null;
  employee_id: string | null;
  /** ISO instant. Future refused; no lower bound (a historical accident is valid). */
  occurred_at: string;
  location_text: string | null;
  location_lat: number | null;
  location_lng: number | null;
  insurance_company: string | null;
  insurance_claim_status: InsuranceClaimStatus | null;
  police_report_status: PoliceReportStatus | null;
  amount_kwd: number | null;
  driver_fault: DriverFault | null;
  case_status: AccidentCaseStatus | null;
  vehicle_case_status: VehicleCaseStatus | null;
  fleet_comment: string | null;
  replacement_plate: string | null;
  other_party_name: string | null;
  other_party_plate: string | null;
  other_party_phone: string | null;
  /** Free text from the report form. `notes` is the legacy fallback. */
  description: string | null;
  attachments: AccidentAttachmentMeta[];
  attachment_keys: string[];
  source: AccidentSource;
  reported_by: string | null;
  reported_by_name: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  review_note: string | null;
  /** Legacy severity (`low` / `medium` / `high`). Kept and still rendered. */
  severity: string | null;
  notes: string | null;
  storage_key: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

/** A vehicle the operator can file an accident against. */
export type AccidentVehicleOption = {
  id: string;
  plate: string;
  model: string | null;
  model_year: number | null;
  company_name: string | null;
  driver_id: string | null;
  driver_name: string | null;
  employee_id: string | null;
};

export type AccidentInput = {
  vehicleId: string;
  occurredAt: string;
  locationText: string;
  locationLat: number | null;
  locationLng: number | null;
  driverFault: string;
  caseStatus: string;
  vehicleCaseStatus: string;
  insuranceCompany: string;
  insuranceClaimStatus: string;
  policeReportStatus: string;
  amountKwd: number | null;
  otherPartyName: string;
  otherPartyPlate: string;
  otherPartyPhone: string;
  description: string;
  fleetComment: string;
  replacementPlate: string;
  /** Optional legacy column — written only when the operator picks one. */
  severity: string;
  notes: string;
  attachmentKeys: string[];
};

export type AccidentFilters = {
  caseStatus: string;
  source: string;
  vehicleId: string;
  driverId: string;
  from: string;
  to: string;
  insuranceClaimStatus: string;
  policeReportStatus: string;
};

export const EMPTY_ACCIDENT_FILTERS: AccidentFilters = {
  caseStatus: "",
  source: "",
  vehicleId: "",
  driverId: "",
  from: "",
  to: "",
  insuranceClaimStatus: "",
  policeReportStatus: "",
};

