export const ASSET_ERROR_KEYS = [
  "not_authorized",
  "save_failed",
  "missing_fields",
  "invalid_code",
  "code_exists",
  "insufficient_stock",
  "catalog_not_found",
  "assignment_not_found",
  "stock_below_assigned",
  "invalid_quantity",
  "file_too_large",
  "invalid_type",
  "upload_failed",
] as const;

export type AssetErrorKey = (typeof ASSET_ERROR_KEYS)[number];

export function isAssetErrorKey(value: string | undefined): value is AssetErrorKey {
  return ASSET_ERROR_KEYS.includes(value as AssetErrorKey);
}
