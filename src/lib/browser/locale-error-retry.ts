export const LOCALE_ERROR_RETRY_KEY = "mghub-locale-error-retries";
export const LOCALE_ERROR_MAX_RETRIES = 3;

export function readLocaleErrorRetries(): number {
  if (typeof sessionStorage === "undefined") return 0;
  const n = Number(sessionStorage.getItem(LOCALE_ERROR_RETRY_KEY) ?? "0");
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function bumpLocaleErrorRetries(): number {
  const next = readLocaleErrorRetries() + 1;
  if (typeof sessionStorage === "undefined") return next;
  sessionStorage.setItem(LOCALE_ERROR_RETRY_KEY, String(next));
  return next;
}

export function clearLocaleErrorRetries(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(LOCALE_ERROR_RETRY_KEY);
}
