/** Plain numeric driver codes from `driver_code_seq` (exactly 5 digits, e.g. 10001). */
export const DRIVER_CODE_LENGTH = 5;
export const DRIVER_CODE_SEQUENCE_START = 10001;
export const DRIVER_CODE_SEQUENCE_MAX = 99999;
export const DRIVER_CODE_REGEX = /^[0-9]{5}$/;

export function formatDriverCodeDisplay(code: string): string {
  const trimmed = code.trim();
  if (!trimmed) return "—";
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

export function parseDriverCodeNumber(code: string): number | null {
  const match = DRIVER_CODE_REGEX.exec(code.trim());
  if (!match) return null;
  return Number.parseInt(match[0], 10);
}

export function isValidDriverCode(code: string): boolean {
  return parseDriverCodeNumber(code) !== null;
}
