export type OpsColumnFilter = Partial<Record<string, string[]>>;

/** Excel-style AND: empty/missing key = all values for that column. */
export function applyColumnFilters<T extends Record<string, unknown>>(
  rows: T[],
  filters: OpsColumnFilter,
): T[] {
  const entries = Object.entries(filters).filter(([, v]) => v && v.length > 0);
  if (entries.length === 0) return rows;
  return rows.filter((row) =>
    entries.every(([key, allowed]) => {
      const raw = row[key];
      const value = raw == null ? "" : String(raw);
      return allowed!.includes(value);
    }),
  );
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
