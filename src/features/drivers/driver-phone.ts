export const KUWAIT_PHONE_DIGIT_COUNT = 8;
export const CIVIL_ID_DIGIT_COUNT = 12;

/** Keep only digits, capped at maxLen (for controlled inputs). */
export function restrictDigits(value: string, maxLen: number): string {
  return value.replace(/\D/g, "").slice(0, maxLen);
}

export function isValidKuwaitPhoneDigits(digits: string): boolean {
  return /^\d{8}$/.test(digits);
}

export function isValidCivilIdDigits(digits: string): boolean {
  return /^\d{12}$/.test(digits);
}

/** Stored in DB with +965 so legacy rows and uniqueness checks stay consistent. */
export function phoneDigitsToStorage(eightDigits: string): string {
  return `+965${eightDigits}`;
}

export function phoneStorageToDigits(stored: string): string {
  const digits = stored.replace(/\D/g, "");
  if (digits.length === 8) return digits;
  if (digits.startsWith("965") && digits.length >= 11) return digits.slice(-8);
  return digits;
}

/** Placeholder for a driver who has no mobile number on file. */
export const NO_PHONE_DISPLAY = "—";

/**
 * Admin UI: always show 8 digits, never +965.
 *
 * Accepts null because the number is optional — every list, table and detail
 * row that renders a phone goes through here, so making the absent case safe
 * once is what keeps a driver with no number from breaking a page.
 */
export function formatPhoneDisplay(stored: string | null | undefined): string {
  if (!stored?.trim()) return NO_PHONE_DISPLAY;
  const digits = phoneStorageToDigits(stored);
  return isValidKuwaitPhoneDigits(digits) ? digits : stored;
}

function toAsciiDigits(s: string): string {
  const arabicIndic = "٠١٢٣٤٥٦٧٨٩";
  const easternArabic = "۰۱۲۳۴۵۶۷۸۹";
  return s
    .split("")
    .map((ch) => {
      const a = arabicIndic.indexOf(ch);
      if (a >= 0) return String(a);
      const e = easternArabic.indexOf(ch);
      if (e >= 0) return String(e);
      return ch;
    })
    .join("");
}

/**
 * Extract the 8 local Kuwait digits from form/spreadsheet input.
 * Accepts `99123456`, `+96599123456`, or `96599123456`.
 */
export function kuwaitLocalDigits(input: string): string | null {
  const digits = toAsciiDigits(String(input)).replace(/\D/g, "");
  if (digits.length === KUWAIT_PHONE_DIGIT_COUNT) return digits;
  if (digits.length === 11 && digits.startsWith("965")) return digits.slice(-8);
  return null;
}

/** Parse form / API / import input to stored `+965XXXXXXXX`, or null. */
export function normalizeKuwaitPhone(input: string): string | null {
  const local = kuwaitLocalDigits(input);
  if (!local || !isValidKuwaitPhoneDigits(local)) return null;
  return phoneDigitsToStorage(local);
}

export function normalizeCivilId(input: string): string | null {
  const digits = restrictDigits(input, CIVIL_ID_DIGIT_COUNT);
  if (!isValidCivilIdDigits(digits)) return null;
  return digits;
}
