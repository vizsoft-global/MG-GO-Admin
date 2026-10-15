import type { GroupedRows } from "./types";

export type GroupAccessor<T> = (row: T) => string | null | undefined;

export function groupRows<T>(
  rows: readonly T[],
  groupBy: string,
  accessors: Record<string, GroupAccessor<T>>,
  labels: Record<string, string> = {},
  unassignedLabel = "Unassigned",
): GroupedRows<T>[] {
  if (!groupBy || groupBy === "none") {
    return [{ key: "all", label: "", rows: [...rows] }];
  }
  const read = accessors[groupBy];
  if (!read) return [{ key: "all", label: "", rows: [...rows] }];

  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const raw = read(row);
    const key = raw && String(raw).trim() ? String(raw) : "unassigned";
    const list = buckets.get(key);
    if (list) list.push(row);
    else buckets.set(key, [row]);
  }

  return [...buckets.entries()]
    .map(([key, grouped]) => ({
      key,
      label: key === "unassigned" ? unassignedLabel : labels[key] ?? key,
      rows: grouped,
    }))
    .sort((a, b) => {
      if (a.key === "unassigned") return 1;
      if (b.key === "unassigned") return -1;
      return a.label.localeCompare(b.label);
    });
}

export function groupCounts<T>(
  rows: readonly T[],
  groupBy: string,
  accessors: Record<string, GroupAccessor<T>>,
): { key: string; count: number }[] {
  return groupRows(rows, groupBy, accessors).map((bucket) => ({
    key: bucket.key,
    count: bucket.rows.length,
  }));
}
