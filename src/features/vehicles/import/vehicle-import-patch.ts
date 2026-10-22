/**
 * Cell semantics for the vehicle bulk-import sheet (v2).
 *
 * - **Blank** cell → the field keeps whatever the vehicle already has. On a new
 *   row it means "use the default" (bike / active / fuel limit default).
 * - **`-`** cell → the field is cleared (`null`).
 * - Anything else → the normalized value is written.
 *
 * These helpers are pure so the preview and the tests share one rule; the
 * server action and the dialog never re-implement it.
 */

/** A lone dash is the "clear this field" token. */
export const CLEAR_TOKEN = "-";

export type CellIntent =
  | { kind: "keep" }
  | { kind: "clear" }
  | { kind: "value"; value: string };

export function cellIntent(raw: string | undefined): CellIntent {
  if (raw === undefined) return { kind: "keep" };
  const text = raw.trim();
  if (!text) return { kind: "keep" };
  if (text === CLEAR_TOKEN) return { kind: "clear" };
  return { kind: "value", value: text };
}

export function isCleared(raw: string | undefined): boolean {
  return cellIntent(raw).kind === "clear";
}

/** Text field: blank keeps `fallback`, `-` clears, a value wins. */
export function patchedText(raw: string | undefined, fallback: string | null): string | null {
  const intent = cellIntent(raw);
  if (intent.kind === "keep") return fallback;
  if (intent.kind === "clear") return null;
  return intent.value;
}

export function normalizeEnumValue(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Enum field with the same blank/`-` rule; `fallback` survives a blank cell. */
export function patchedEnum<T extends string>(
  raw: string | undefined,
  fallback: string | null,
  guard: (value: string | null | undefined) => value is T,
): T | null {
  const intent = cellIntent(raw);
  if (intent.kind === "keep") return guard(fallback) ? fallback : null;
  if (intent.kind === "clear") return null;
  const normalized = normalizeEnumValue(intent.value);
  return guard(normalized) ? normalized : null;
}

const YMD_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/;
const DMY_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/**
 * A sheet date → `YYYY-MM-DD` (Kuwait midnight ISO), or `null` when the cell is
 * not a date at all. `ISO` datetimes (`2025-01-15T00:00:00.000Z`) and
 * `DD/MM/YYYY` are accepted because that is what Excel hands back.
 */
export function parseSheetDate(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const ymd = YMD_RE.exec(text);
  const dmy = ymd ? null : DMY_RE.exec(text);
  const year = Number(ymd?.[1] ?? dmy?.[3]);
  const month = Number(ymd?.[2] ?? dmy?.[2]);
  const day = Number(ymd?.[3] ?? dmy?.[1]);
  if (!year || !month || !day) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return `${ymd ? `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}` : `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`}T00:00:00+03:00`;
}

export type DateCellIntent =
  | { kind: "keep" }
  | { kind: "clear" }
  | { kind: "value"; iso: string }
  | { kind: "invalid" };

export function dateCellIntent(raw: string | undefined): DateCellIntent {
  const intent = cellIntent(raw);
  if (intent.kind === "keep") return { kind: "keep" };
  if (intent.kind === "clear") return { kind: "clear" };
  const iso = parseSheetDate(intent.value);
  return iso ? { kind: "value", iso } : { kind: "invalid" };
}

/** `true` when `expiry` is a real date that lands before `issued`. */
export function expiryBeforeIssue(issued: string | null, expiry: string | null): boolean {
  if (!issued || !expiry) return false;
  const issuedMs = Date.parse(issued);
  const expiryMs = Date.parse(expiry);
  if (!Number.isFinite(issuedMs) || !Number.isFinite(expiryMs)) return false;
  return expiryMs < issuedMs;
}

/** Lower-cased, whitespace-collapsed key for catalog lookups (keys, names). */
export function lookupKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
