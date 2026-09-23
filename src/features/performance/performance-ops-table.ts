export type OpsRangeFilter = { min?: number | null; max?: number | null };

export type OpsColumnFilter = Partial<Record<string, string[] | OpsRangeFilter>>;

export type OpsSortDir = "asc" | "desc";

export function isRangeFilter(value: unknown): value is OpsRangeFilter {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function rangeFilterActive(range: OpsRangeFilter | undefined): boolean {
  if (!range) return false;
  return range.min != null || range.max != null;
}

/** Excel-style AND: empty/missing key = all values for that column. */
export function applyColumnFilters<T extends Record<string, unknown>>(
  rows: T[],
  filters: OpsColumnFilter,
): T[] {
  const entries = Object.entries(filters).filter(([, v]) => {
    if (!v) return false;
    if (isRangeFilter(v)) return rangeFilterActive(v);
    return v.length > 0;
  });
  if (entries.length === 0) return rows;
  return rows.filter((row) =>
    entries.every(([key, allowed]) => {
      const raw = row[key];
      if (isRangeFilter(allowed)) {
        const n = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isFinite(n)) return false;
        if (allowed.min != null && Number.isFinite(allowed.min) && n < allowed.min) return false;
        if (allowed.max != null && Number.isFinite(allowed.max) && n > allowed.max) return false;
        return true;
      }
      const value = raw == null ? "" : String(raw);
      return Array.isArray(allowed) && allowed.includes(value);
    }),
  );
}

function compareOpsCell(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const an = typeof a === "number" ? a : Number(a);
  const bn = typeof b === "number" ? b : Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return String(a).localeCompare(String(b));
}

export function sortOpsRiders<T extends Record<string, unknown>>(
  rows: readonly T[],
  key: string | null,
  dir: OpsSortDir | null,
): T[] {
  const sortKey = key && dir ? key : "orders";
  const sortDir: OpsSortDir = key && dir ? dir : "desc";
  return [...rows].sort((a, b) => {
    const cmp = compareOpsCell(a[sortKey], b[sortKey]);
    if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
    return String(a.name ?? "").localeCompare(String(b.name ?? ""));
  });
}

export function nextOpsSort(
  currentKey: string | null,
  currentDir: OpsSortDir | null,
  clicked: string,
): { key: string | null; dir: OpsSortDir | null } {
  if (currentKey !== clicked) return { key: clicked, dir: "asc" };
  if (currentDir === "asc") return { key: clicked, dir: "desc" };
  return { key: null, dir: null };
}

const OPS_BUCKET_KEYS = new Set(["well_above", "above", "near", "below", "well_below"]);

/** Column-popover label: empty → em dash; bucket slug → i18n; else raw value. */
export function filterOptionLabel(
  key: string,
  value: string,
  translate: (messageKey: string) => string,
): string {
  if (!value) return "—";
  if (key === "bucket" && OPS_BUCKET_KEYS.has(value)) return translate(`bucket.${value}`);
  return value;
}

export function columnFilterValues<T extends Record<string, unknown>>(
  rows: T[],
  key: string,
): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    const raw = row[key];
    set.add(raw == null ? "" : String(raw));
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function toCsv(headers: string[], rows: Array<Array<string | number | null>>): string {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
