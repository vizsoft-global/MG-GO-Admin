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

/** Admin UI: always show 8 digits, never +965. */
export function formatPhoneDisplay(stored: string): string {
  const digits = phoneStorageToDigits(stored);
  return isValidKuwaitPhoneDigits(digits) ? digits : stored;
}

/** Parse form / API input: exactly 8 digits, or null. */
export function normalizeKuwaitPhone(input: string): string | null {
  const digits = restrictDigits(input, KUWAIT_PHONE_DIGIT_COUNT);
  if (!isValidKuwaitPhoneDigits(digits)) return null;
  return phoneDigitsToStorage(digits);
}

export function normalizeCivilId(input: string): string | null {
  const digits = restrictDigits(input, CIVIL_ID_DIGIT_COUNT);
  if (!isValidCivilIdDigits(digits)) return null;
  return digits;
}
