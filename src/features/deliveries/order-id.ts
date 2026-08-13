/** Partner Order ID: ASCII digits only, 1–32 chars (app hint e.g. 12345). */
export const EXTERNAL_ORDER_ID_MAX_LEN = 32;
export const EXTERNAL_ORDER_ID_RE = /^[0-9]{1,32}$/;

const DISPLAY_INVALID_MAX = 16;

export function normalizeExternalOrderId(raw: string): string {
  let v = raw.trim();
  while (v.startsWith("#")) {
    v = v.slice(1).trim();
  }
  return v;
}

export function isValidExternalOrderId(raw: string): boolean {
  return EXTERNAL_ORDER_ID_RE.test(normalizeExternalOrderId(raw));
}

/** Valid ids as-is; historical junk is truncated so list/detail cannot overflow. */
export function displayExternalOrderId(raw: string | null | undefined): string {
  if (raw == null) return "—";
  const v = raw.trim();
  if (!v) return "—";
  if (isValidExternalOrderId(v)) return normalizeExternalOrderId(v);
  if (v.length <= DISPLAY_INVALID_MAX) return v;
  return `${v.slice(0, DISPLAY_INVALID_MAX)}…`;
}
