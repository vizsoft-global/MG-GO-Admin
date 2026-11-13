/**
 * The payroll funnel's value shapes and the rules that apply them to a row.
 *
 * Separated from the header component so those rules can be asserted without a
 * renderer — they are the difference between what a column filter means and how
 * the popover that sets it looks.
 */
import { numericInRange } from "@/lib/search/numeric";
export type ColumnFilterValue =
  | { kind: "text"; text: string }
  | { kind: "list"; values: string[] }
  | { kind: "range"; min: number | null; max: number | null };

export type ColumnFilters = Record<string, ColumnFilterValue>;

export type ColumnSort = { columnId: string; dir: "asc" | "desc" } | null;

export function columnFilterActive(filter: ColumnFilterValue | undefined): boolean {
  if (!filter) return false;
  if (filter.kind === "text") return filter.text.trim().length > 0;
  if (filter.kind === "list") return filter.values.length > 0;
  return filter.min !== null || filter.max !== null;
}

export function textMatches(value: string, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (!needle) return true;
  return value.toLowerCase().includes(needle);
}

export function listMatches(value: string, values: readonly string[]): boolean {
  if (!values.length) return true;
  return values.includes(value);
}

export function rangeMatches(
  value: number,
  min: number | null,
  max: number | null,
): boolean {
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

export function matchesColumnFilter(
  value: string | number | null,
  filter: ColumnFilterValue | undefined,
  numeric = false,
  textValue?: string,
): boolean {
  if (!columnFilterActive(filter) || !filter) return true;
  // A column can print something other than its stored value (Efficiency shows
  // `87.1%`), so Text mode is matched against the printed string.
  if (filter.kind === "text") return textMatches(textValue ?? String(value ?? ""), filter.text);
  if (filter.kind === "list") return listMatches(String(value ?? ""), filter.values);
  void numeric;
  /**
   * Range is answered against the printed figure, parsed — `30 KWD`, `22.4%`,
   * `12 h` and `1,234.50` all compare as numbers. Falling back to the stored
   * value keeps a raw number working when the column has no printed form.
   */
  return numericInRange(textValue ?? value, filter.min, filter.max);
}

/** True when a row passes every active column filter. */
export function rowMatchesColumnFilters(
  row: Record<string, string | number | null>,
  filters: ColumnFilters,
  numericColumns: ReadonlySet<string> = new Set(),
  textOf?: (columnId: string, value: string | number | null) => string,
): boolean {
  for (const [columnId, filter] of Object.entries(filters)) {
    if (!columnFilterActive(filter)) continue;
    const value = row[columnId] ?? null;
    if (!matchesColumnFilter(value, filter, numericColumns.has(columnId), textOf?.(columnId, value))) {
      return false;
    }
  }
  return true;
}

export function activeFilterChips(
  filters: ColumnFilters,
  labelFor: (columnId: string) => string,
  listSeparator = ", ",
): Array<{ columnId: string; text: string }> {
  const chips: Array<{ columnId: string; text: string }> = [];
  for (const [columnId, filter] of Object.entries(filters)) {
    if (!columnFilterActive(filter)) continue;
    if (filter.kind === "text") {
      chips.push({ columnId, text: `${labelFor(columnId)}: ${filter.text.trim()}` });
    } else if (filter.kind === "list") {
      chips.push({ columnId, text: `${labelFor(columnId)}: ${filter.values.join(listSeparator)}` });
    } else {
      const min = filter.min === null ? "" : String(filter.min);
      const max = filter.max === null ? "" : String(filter.max);
      chips.push({ columnId, text: `${labelFor(columnId)}: ${min}–${max}` });
    }
  }
  return chips;
}

/** Sorts rows by a column accessor, leaving the input untouched. */
export function sortByColumn<T>(
  rows: readonly T[],
  sort: ColumnSort,
  accessor: (row: T, columnId: string) => string | number | null,
): T[] {
  if (!sort) return [...rows];
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = accessor(a, sort.columnId);
    const right = accessor(b, sort.columnId);
    if (typeof left === "number" && typeof right === "number") {
      return (left - right) * factor;
    }
    const ls = String(left ?? "");
    const rs = String(right ?? "");
    return ls.localeCompare(rs, undefined, { numeric: true, sensitivity: "base" }) * factor;
  });
}
