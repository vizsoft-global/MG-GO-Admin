/** Partner merchant IDs in production are numeric (Talabat / KFC / Hardee's). */
export const EXTERNAL_MERCHANT_ID_MAX_LEN = 32;

const EXTERNAL_MERCHANT_ID_RE = /^[0-9]{1,32}$/;

export function normalizeExternalMerchantId(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, EXTERNAL_MERCHANT_ID_MAX_LEN);
}

/** Empty is allowed. Non-empty values must be 1–32 digits. */
export function validateExternalMerchantId(
  value: string,
): "invalid_external_merchant_id" | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!EXTERNAL_MERCHANT_ID_RE.test(trimmed)) {
    return "invalid_external_merchant_id";
  }
  return null;
}
