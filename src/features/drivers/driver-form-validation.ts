import { hasOpsAssignment, NONE_ZONE, requiresOpsAssignment } from "./driver-assignment";
import { isValidEmployeeId } from "./driver-errors";

export { NONE_ZONE };
import {
  isValidCivilIdDigits,
  isValidKuwaitPhoneDigits,
  restrictDigits,
} from "./driver-phone";
import {
  DOCUMENT_TYPES,
  type DriverDocumentType,
} from "./types";
import type { DriverErrorKey } from "./driver-errors";
import { ALLOWED_LOGO_EXTENSIONS, MAX_LOGO_BYTES } from "@/lib/branding/constants";

export const NONE_VEHICLE = "__none__";

export const NONE_PARTNER = "__none_partner__";

export type DriverFormField =
  | "fullName"
  | "phone"
  | "civilId"
  | "passportNumber"
  | "employeeId"
  | "partnerId"
  | "zoneId"
  | "restaurants";

export type DriverFormErrors = Partial<
  Record<DriverFormField | `document_${DriverDocumentType}`, DriverErrorKey>
>;

export const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
export const ALLOWED_DOC_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

/** Validate a single picked file before it is stored in form state. */
export function validateDocumentFile(file: File): DriverErrorKey | null {
  if (file.size > MAX_DOCUMENT_BYTES) return "file_too_large";
  if (!ALLOWED_DOC_MIME.has(file.type)) return "invalid_file_type";
  return null;
}

const AVATAR_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

/** Validate profile photo before storing in form state. */
export function validateAvatarFile(file: File): DriverErrorKey | null {
  if (file.size > MAX_LOGO_BYTES) return "file_too_large";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_LOGO_EXTENSIONS.includes(ext as (typeof ALLOWED_LOGO_EXTENSIONS)[number])) {
    return "invalid_file_type";
  }
  if (file.type && !AVATAR_MIME.has(file.type)) return "invalid_file_type";
  return null;
}

export type ValidateDriverFormInput = {
  fullName: string;
  phone: string;
  civilId: string;
  /** Mandatory with phone and civil ID; normalised to A-Z / 0-9. */
  passportNumber?: string;
  employeeId: string;
  partnerId: string;
  zoneId: string;
  restaurantIds: readonly string[];
  documents: Record<DriverDocumentType, File | null>;
  /** HR sections the rider belongs to; a non-operational section needs no zone. */
  sectionKeys?: readonly string[];
  sections?: readonly { key: string; is_operational?: boolean }[];
};

export function validateDriverForm(
  input: ValidateDriverFormInput,
): DriverFormErrors {
  const errors: DriverFormErrors = {};

  if (!input.fullName.trim()) {
    errors.fullName = "missing_fields";
  }

  // Civil ID, mobile and passport are mandatory on every write path: they are
  // the three facts HR reconciles a rider against. A blank is a missing field,
  // a half-typed value is an invalid one, and the two are named differently so
  // the operator knows which they are looking at.
  const phoneDigits = restrictDigits(input.phone.trim(), 8);
  if (!phoneDigits) errors.phone = "missing_fields";
  else if (!isValidKuwaitPhoneDigits(phoneDigits)) errors.phone = "invalid_phone";

  const civilDigits = restrictDigits(input.civilId.trim(), 12);
  if (!civilDigits) errors.civilId = "missing_fields";
  else if (!isValidCivilIdDigits(civilDigits)) errors.civilId = "invalid_civil_id";

  const passport = (input.passportNumber ?? "").trim().toUpperCase();
  if (!passport) errors.passportNumber = "missing_fields";
  else if (!/^[A-Z0-9]{5,20}$/.test(passport)) errors.passportNumber = "invalid_passport";

  const employeeId = input.employeeId.trim();
  if (!employeeId) {
    errors.employeeId = "missing_fields";
  } else if (!isValidEmployeeId(employeeId)) {
    errors.employeeId = "employee_id_format";
  }

  // Zone-only and restaurant-only fleets are both legal. A driver with
  // neither has nowhere to work and is refused here rather than at approve —
  // unless every one of their HR sections is non-operational (MG Head Office),
  // which has no zone or store by design.
  const opsRequired = requiresOpsAssignment(input.sectionKeys ?? [], input.sections ?? []);
  if (opsRequired && !hasOpsAssignment(input.zoneId, input.restaurantIds)) {
    errors.zoneId = "missing_assignment";
    errors.restaurants = "missing_assignment";
  }

  for (const docType of DOCUMENT_TYPES) {
    const file = input.documents[docType];
    if (!file) continue;
    const fileError = validateDocumentFile(file);
    if (fileError) errors[`document_${docType}`] = fileError;
  }

  return errors;
}

export function hasValidationErrors(errors: DriverFormErrors): boolean {
  return Object.keys(errors).length > 0;
}
