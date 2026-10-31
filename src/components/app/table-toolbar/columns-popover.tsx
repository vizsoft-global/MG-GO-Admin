"use client";

import { AppTableColumnPicker } from "@/components/app/app-table-column-picker";
import type { TableToolbarColumn } from "./toolbar-config";

export function ColumnsPopover({
  columns,
  isVisible,
  onToggle,
  onReset,
  onReorder,
  visibleCount,
}: {
  columns: TableToolbarColumn[];
  isVisible: (id: string) => boolean;
  onToggle: (id: string) => void;
  onReset: () => void;
  onReorder: (activeId: string, overId: string) => void;
  visibleCount: number;
}) {
  return (
    <AppTableColumnPicker
      options={columns.map((column) => ({
        id: column.id,
        label: column.locked ? `${column.label} *` : column.label,
      }))}
      isVisible={isVisible}
      onToggle={onToggle}
      onReset={onReset}
      onReorder={onReorder}
      hiddenCount={Math.max(0, columns.length - visibleCount)}
      iconOnly
    />
  );
}
