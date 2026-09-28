import type { ComparisonRider, ComparisonResult } from "./order-comparison-model";

export type ComparisonContainsFilter = { contains: string };
export type ComparisonRangeFilter = { min?: number | null; max?: number | null };
export type ComparisonFilterValue = ComparisonContainsFilter | string[] | ComparisonRangeFilter;
export type ComparisonColumnFilters = Partial<Record<string, ComparisonFilterValue>>;

export function isContainsFilter(value: unknown): value is ComparisonContainsFilter {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && "contains" in value;
}

export function isRangeFilter(value: unknown): value is ComparisonRangeFilter {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !("contains" in value);
}

export function rangeFilterActive(range: ComparisonRangeFilter | undefined): boolean {
  if (!range) return false;
  return range.min != null || range.max != null;
}

export function filterActive(value: ComparisonFilterValue | undefined): boolean {
  if (!value) return false;
  if (isContainsFilter(value)) return value.contains.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return rangeFilterActive(value);
}

const TEXT_KEYS = new Set(["mgId", "name"]);
const LIST_KEYS = new Set(["restaurant"]);

export function filterKind(columnId: string): "text" | "list" | "range" {
  if (TEXT_KEYS.has(columnId)) return "text";
  if (LIST_KEYS.has(columnId)) return "list";
  return "range";
}

function cellValue(row: ComparisonRider, key: string): string | number {
  switch (key) {
    case "mgId":
      return row.mgId;
    case "name":
      return row.name;
    case "restaurant":
      return row.restaurant;
    case "am":
      return row.am;
    case "mggo":
      return row.mggo;
    case "diff":
      return row.diff;
    case "offDays":
      return row.offDays;
    case "workedDays":
      return row.workedDays;
    default:
      return "";
  }
}

export function applyComparisonFilters(
  rows: ComparisonRider[],
  filters: ComparisonColumnFilters,
): ComparisonRider[] {
  const entries = Object.entries(filters).filter(([, v]) => filterActive(v));
  if (entries.length === 0) return rows;
  return rows.filter((row) =>
    entries.every(([key, allowed]) => {
      const raw = cellValue(row, key);
      if (isContainsFilter(allowed)) {
        return String(raw).toLowerCase().includes(allowed.contains.trim().toLowerCase());
      }
      if (isRangeFilter(allowed)) {
        const n = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isFinite(n)) return false;
        if (allowed.min != null && Number.isFinite(allowed.min) && n < allowed.min) return false;
        if (allowed.max != null && Number.isFinite(allowed.max) && n > allowed.max) return false;
        return true;
      }
      return Array.isArray(allowed) && allowed.includes(String(raw));
    }),
  );
}

export function applySearch(rows: ComparisonRider[], query: string): ComparisonRider[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter(
    (row) =>
      row.mgId.toLowerCase().includes(needle) ||
      row.name.toLowerCase().includes(needle) ||
      row.restaurant.toLowerCase().includes(needle),
  );
}

export function applyPageFilters(
  rows: ComparisonRider[],
  opts: {
    search: string;
    result: ComparisonResult | null;
    dayIndex: number | null;
    columns: ComparisonColumnFilters;
  },
): ComparisonRider[] {
  let next = rows;
  if (opts.result && opts.result !== "no_orders") {
    next = next.filter((row) => row.result === opts.result);
  }
  if (opts.dayIndex != null) {
    next = next.filter((row) => (row.diffDays[opts.dayIndex!] ?? 0) !== 0);
  }
  next = applySearch(next, opts.search);
  return applyComparisonFilters(next, opts.columns);
}

export function columnFilterValues(rows: ComparisonRider[], key: string): string[] {
  const set = new Set<string>();
  for (const row of rows) set.add(String(cellValue(row, key)));
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function filterChipLabel(
  columnId: string,
  value: ComparisonFilterValue,
  labels: Record<string, string>,
): string {
  const name = labels[columnId] ?? columnId;
  if (isContainsFilter(value)) return `${name}: ${value.contains}`;
  if (isRangeFilter(value)) {
    const min = value.min == null ? "" : String(value.min);
    const max = value.max == null ? "" : String(value.max);
    return `${name}: ${min || "…"}–${max || "…"}`;
  }
  return `${name}: ${value.join(", ")}`;
}

export function activeFilterEntries(
  filters: ComparisonColumnFilters,
): Array<{ id: string; value: ComparisonFilterValue }> {
  return Object.entries(filters)
    .filter(([, v]) => filterActive(v))
    .map(([id, value]) => ({ id, value: value! }));
}
