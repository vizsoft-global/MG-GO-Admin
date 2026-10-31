import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Column order for list pages: ID, Name, Project, context, Status, Actions. */
export type FrameColumn<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: "start" | "end";
};

export function FrameDataTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  empty,
}: {
  columns: ReadonlyArray<FrameColumn<T>>;
  rows: readonly T[];
  rowKey: (row: T) => string;
  sort?: { columnId: string; dir: "asc" | "desc" };
  onSort?: (columnId: string) => void;
  empty?: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border-default)] bg-[var(--surface-card)]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                className={cn(
                  "px-[var(--table-cell-x)] py-[var(--table-cell-y)] text-start text-xs font-semibold text-[var(--text-secondary)]",
                  column.align === "end" && "text-end",
                )}
              >
                {onSort ? (
                  <button type="button" className="inline-flex h-9 items-center gap-1" onClick={() => onSort(column.id)}>
                    {column.header}
                    {sort?.columnId === column.id ? (sort.dir === "asc" ? "↑" : "↓") : null}
                  </button>
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="px-[var(--table-cell-x)] py-[var(--table-cell-y)] text-[var(--text-muted)]" colSpan={columns.length}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="border-t border-[var(--border-default)]">
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={cn(
                      "px-[var(--table-cell-x)] py-[var(--table-cell-y)] text-[var(--text-primary)]",
                      column.align === "end" && "text-end tabular-nums",
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
