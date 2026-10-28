"use client";

import {
  TableToolbar,
  type TableRowKind,
  type TableToolbarColumn,
  type useTablePrefs,
} from "@/components/app/table-toolbar";

export type TablePrefs = ReturnType<typeof useTablePrefs>;

export function rowMatches(
  query: string,
  parts: readonly (string | number | null | undefined)[],
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return parts.some((part) => String(part ?? "").toLowerCase().includes(needle));
}

export function groupRows<T>(
  rows: readonly T[],
  groupBy: string,
  labelOf: (row: T) => string,
): { key: string; label: string; rows: T[] }[] {
  if (!groupBy || groupBy === "none") return [{ key: "all", label: "", rows: [...rows] }];
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const label = labelOf(row).trim() || "—";
    const bucket = map.get(label);
    if (bucket) bucket.push(row);
    else map.set(label, [row]);
  }
  return [...map.entries()].map(([label, group]) => ({ key: label, label, rows: group }));
}

export function visibleColumnIds(prefs: TablePrefs): string[] {
  return prefs.orderedColumns.filter((column) => prefs.isVisible(column.id)).map((column) => column.id);
}

export function ListToolbar({
  prefs,
  entity,
  columns,
  rowKind,
  fixedRows,
  entityList,
  filteredCount,
  totalCount,
  onExport,
  onAdd,
  addLabel,
}: {
  prefs: TablePrefs;
  entity: string;
  columns: TableToolbarColumn[];
  rowKind: TableRowKind;
  fixedRows?: number;
  entityList?: boolean;
  filteredCount: number;
  totalCount: number;
  onExport?: () => void;
  onAdd?: () => void;
  addLabel?: string;
}) {
  return (
    <TableToolbar
      prefs={prefs}
      entity={entity}
      columns={columns}
      rowKind={rowKind}
      fixedRows={fixedRows}
      entityList={entityList}
      filteredCount={filteredCount}
      totalCount={totalCount}
      onExport={onExport}
      onAdd={onAdd}
      addLabel={addLabel}
    />
  );
}

export function groupBanner(label: string, count: number): string {
  return `${label} ${count}`;
}
