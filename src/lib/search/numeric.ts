/**
 * Reading a printed cell back as a number, for Range filters.
 *
 * A Range filter is answered against what the operator can see, and what the
 * operator sees is formatted: `30 KWD`, `22.4%`, `12 h`, `1,234.50`, `—`. Feeding
 * any of those to `Number()` gives `NaN`, and a `NaN` comparison is `false` for
 * every row — so a Min on a money column used to hide the entire table instead of
 * narrowing it. This is the one place that turns the printed string back into the
 * figure the comparison needs.
 *
 * Deliberately not `parseFloat`: `parseFloat("1,234")` is `1`, and a range of
 * "1000 and up" would then quietly include a rider who earned 1.
 */
export function parseNumericText(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value == null) return null;
  const text = value.trim();
  if (text === "") return null;

  // Any placeholder the panel prints for "no figure" answers null, not zero.
  if (/^[—–\-_.]+$/.test(text)) return null;

  // One leading sign, digits with optional group separators and one decimal part.
  // Everything else in the string (currency, `%`, `h`, a trailing word) is dropped.
  const match = text.match(/-?\d[\d,\s]*(?:\.\d+)?|-?\.\d+/);
  if (!match) return null;
  const cleaned = match[0].replace(/[,\s]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Inclusive range test. `min <= value <= max`, and an absent bound is open.
 *
 * A value that cannot be read answers `false`: an unreadable cell is not inside
 * a range the operator asked for, and treating it as `0` would put it in every
 * "0 to N" filter.
 */
export function numericInRange(
  value: string | number | null | undefined,
  min: number | null,
  max: number | null,
): boolean {
  const parsed = parseNumericText(value);
  if (parsed === null) return false;
  if (min !== null && parsed < min) return false;
  if (max !== null && parsed > max) return false;
  return true;
}
