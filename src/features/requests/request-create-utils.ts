/** Payload keys that are derived columns or the declaration checkbox — not free-text inputs. */
const DERIVED_CREATE_KEYS = new Set(["date_range", "duration_days", "declaration_accepted"]);

export function isDerivedCreateField(key: string): boolean {
  return DERIVED_CREATE_KEYS.has(key);
}

/** Leave / sick leave store From–To on columns, not a `start_date` payload key. */
export function typeUsesDateRange(
  type: string,
  fields: ReadonlyArray<{ key: string }>,
): boolean {
  if (type === "leave" || type === "sick_leave") return true;
  return fields.some((field) => field.key === "start_date" || field.key === "date_range");
}

export function isAssetFirstTime(mode: string): boolean {
  return /^\s*first\s*time\s*$/i.test(mode);
}

export function isAssetRenewal(mode: string): boolean {
  return /^\s*renewal\s*$/i.test(mode);
}

/**
 * Fields that actually gate Create. Comment / justification stay optional
 * unless the type itself requires them (asset justification).
 */
export function typedRequiredPayloadKeys(
  type: string,
  draft: Record<string, string>,
): string[] {
  switch (type) {
    case "leave":
      return ["leave_type"];
    case "sick_leave":
      return ["leave_subtype"];
    case "loan":
      return ["tenure_months", "needed_by"];
    case "asset": {
      const keys = ["asset_type", "request_mode", "justification"];
      if (!isAssetFirstTime(draft.request_mode ?? "")) keys.push("asset_current_status");
      return keys;
    }
    case "fuel":
      return ["period_month"];
    case "document":
      return ["document_type"];
    case "complaint":
      return ["category", "subject", "description"];
    case "salary_justification":
      return ["salary_month"];
    default:
      return [];
  }
}

export function shouldShowCreateField(
  key: string,
  draft: Record<string, string>,
): boolean {
  if (isDerivedCreateField(key)) return false;
  if (key === "asset_current_status" && isAssetFirstTime(draft.request_mode ?? "")) {
    return false;
  }
  return true;
}

/** Inclusive calendar-day count, matching the request detail "Days" row. */
export function inclusiveDurationDays(startYmd: string, endYmd: string): number | null {
  if (!startYmd || !endYmd) return null;
  const start = new Date(`${startYmd}T00:00:00`).getTime();
  const end = new Date(`${endYmd}T00:00:00`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / 86_400_000) + 1;
}

export function fuelFinalApproveBlocked(input: {
  requestType: string;
  fuelTransferType: string | null | undefined;
  isFinalStep: boolean;
}): boolean {
  return (
    input.requestType === "fuel" &&
    input.isFinalStep &&
    (input.fuelTransferType == null || input.fuelTransferType === "")
  );
}

/**
 * Same catalogues `rcm_validate_request_input` seeds. Used when the
 * field-definitions query is empty so Create cannot fall back to free text.
 */
const CATALOG_FALLBACKS: Record<string, string[]> = {
  leave_type: ["Annual", "Emergency", "Accident", "Unpaid Leave"],
  leave_subtype: ["Sick leave", "Injury", "Accident", "Other"],
  asset_type: [
    "SIM card",
    "Fuel card",
    "Fuel limit change",
    "Raincoat",
    "Delivery bag",
    "Reflective vest",
    "Winter jacket",
    "Delivery attire",
    "Delivery pants",
    "New bike",
    "Helmet",
    "Delivery box",
    "Fuel chip",
    "Phone",
    "Mobile holder",
  ],
  size: ["S", "M", "L", "XL", "XXL"],
  document_type: [
    "Civil ID copy",
    "License Copy",
    "Work permit copy",
    "Registration copy",
    "Vehicle document copy",
    "Salary certification",
  ],
};

/** Static select options the create RPC will accept — same list the rider app uses. */
export function staticOptionsForField(
  fieldKey: string,
  fields: ReadonlyArray<{ field_key: string; options: readonly string[] }>,
): string[] {
  const fromDb = [...(fields.find((field) => field.field_key === fieldKey)?.options ?? [])];
  return fromDb.length > 0 ? fromDb : (CATALOG_FALLBACKS[fieldKey] ?? []);
}

export function isNeededByInPast(neededBy: string, todayYmd: string): boolean {
  return Boolean(neededBy) && neededBy < todayYmd;
}

/** `invalid_option:leave_type` is a server code, not an i18n path. */
export function parseCreateRequestError(error: string | undefined): {
  key: string;
  field?: string;
} {
  if (!error) return { key: "failed" };
  const option = /^invalid_option:(.+)$/.exec(error);
  if (option) return { key: "invalid_option", field: option[1] };
  const required = /^field_required:(.+)$/.exec(error);
  if (required) return { key: "field_required", field: required[1] };
  return { key: error };
}
