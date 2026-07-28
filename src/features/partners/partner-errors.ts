export const PARTNER_ERROR_KEYS = [
  "not_authorized",
  "missing_fields",
  "slug_exists",
  "has_drivers",
  "has_restaurants",
  "missing_file",
  "file_too_large",
  "invalid_type",
  "upload_failed",
  "save_failed",
] as const;

export type PartnerErrorKey = (typeof PARTNER_ERROR_KEYS)[number];

export function isPartnerErrorKey(value: string | undefined): value is PartnerErrorKey {
  return PARTNER_ERROR_KEYS.includes(value as PartnerErrorKey);
}

export function mapPartnerDbError(error: {
  code?: string;
  message?: string;
}): PartnerErrorKey {
  if (error.code === "23505") return "slug_exists";
  return "save_failed";
}
