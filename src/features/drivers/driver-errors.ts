export const DRIVER_ERROR_KEYS = [
  "not_authorized",
  "missing_fields",
  "invalid_driver_code",
  "invalid_phone",
  "invalid_civil_id",
  "phone_exists",
  "civil_id_exists",
  "employee_id_exists",
  "employee_id_format",
  "driver_code_exists",
  "missing_documents",
  "invalid_document_type",
  "file_too_large",
  "invalid_file_type",
  "upload_failed",
  "r2_not_configured",
  "invalid_restaurants",
  "missing_active_restaurant",
  "missing_block_reason",
  "driver_not_found",
  "intake_already_linked",
  "insufficient_stock",
  "save_failed",
  "expiry_date_required",
  "invalid_custom_fields",
] as const;

export type DriverErrorKey = (typeof DRIVER_ERROR_KEYS)[number];

export function isDriverErrorKey(value: string | undefined): value is DriverErrorKey {
  return DRIVER_ERROR_KEYS.includes(value as DriverErrorKey);
}

export function mapDriverDbError(
  error: { code?: string; message?: string },
  context?: "employee_id",
): DriverErrorKey {
  if (error.code === "23514") {
    const msg = error.message ?? "";
    if (context === "employee_id" || msg.includes("employee_id")) {
      return "employee_id_format";
    }
  }
  if (error.code === "23505") {
    if (context === "employee_id") return "employee_id_exists";
    const msg = error.message ?? "";
    if (msg.includes("employee_id")) return "employee_id_exists";
    if (msg.includes("civil_id")) return "civil_id_exists";
    return "phone_exists";
  }
  return "save_failed";
}

const EMPLOYEE_ID_RE = /^[0-9]{4,8}$/;

export function normalizeEmployeeId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!EMPLOYEE_ID_RE.test(trimmed)) return null;
  return trimmed;
}

export function isValidEmployeeId(raw: string): boolean {
  return EMPLOYEE_ID_RE.test(raw.trim());
}
