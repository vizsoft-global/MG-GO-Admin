"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLocale, useTranslations } from "next-intl";
import {
  Ban,
  Briefcase,
  CalendarOff,
  Clock,
  Download,
  HeartPulse,
  Hourglass,
  PencilLine,
  Siren,
  Timer,
  Truck,
  UserMinus,
  UserX,
} from "lucide-react";
import { TABLE_HEAD_CLASS } from "@/components/app";
import { ToggleChip } from "@/components/app/toggle-chip";
import { cn } from "@/lib/utils";
import {
  countRidersByStatus,
  dayLabel,
  isoDateInMonth,
  PAYROLL_STATUS_CHIP,
  PAYROLL_STATUS_FILTERS,
  shareOfPayroll,
  type DayStatus,
  type PayrollStatusFilter,
} from "./payroll-formulas";
import { formatEfficiencyCell } from "./payroll-csv";
import {
  activeFilterChips,
  columnFilterActive,
  PayrollColumnHeader,
  PayrollFilterChips,
  rowMatchesColumnFilters,
  sortByColumn,
  type ColumnFilters,
  type ColumnSort,
} from "./payroll-column-filter";
import {
  dayClipboardToken,
  dayColumnId,
  isNumericRiderColumn,
  RIDER_IDENTITY_COLUMNS,
  RIDER_TOTAL_COLUMNS,
  riderColumnValue,
} from "./payroll-rider-columns";
import {
  cellsFromSelection,
  parseAdjustmentCellText,
} from "./payroll-snapshot";
import type { PayrollAdjustmentCell, PayrollRiderRow } from "./payroll-types";
export function dayClass(status: DayStatus): string {
  switch (status) {
    case "work":
      return "text-muted-foreground";
    case "reduced3":
      return "bg-sky-100 text-sky-800";
    case "half":
      return "bg-blue-100 text-blue-800";
    case "actual":
      return "bg-violet-100 text-violet-800";
    case "off":
      return "bg-emerald-100 text-emerald-800";
    case "sick":
      return "bg-amber-100 text-amber-800";
    case "accident":
      return "bg-lime-100 text-lime-800";
    case "vehicle":
      return "bg-cyan-100 text-cyan-800";
    case "absent":
      return "bg-red-100 text-red-700";
    case "abs_lh":
      return "bg-orange-100 text-orange-800";
    case "abs_lo":
      return "bg-pink-100 text-pink-800";
    case "custom":
      return "bg-slate-100 text-slate-700";
    case "blank":
      return "text-muted-foreground/40";
    default: {
      const never: never = status;
      return never;
    }
  }
}

function spacerCells(count: number) {
  return Array.from({ length: count }, (_, i) => <td key={i} className="p-0" />);
}

export const PAYROLL_STATUS_ICONS = {
  work: Briefcase,
  reduced3: Hourglass,
  half: Timer,
  actual: Clock,
  off: CalendarOff,
  sick: HeartPulse,
  accident: Siren,
  vehicle: Truck,
  absent: UserX,
  abs_lh: UserMinus,
  abs_lo: Ban,
  custom: PencilLine,
} as const;

/** A rideable cell range, in visible-row and full-column indexes. */
type CellRect = { r0: number; c0: number; r1: number; c1: number };

export type PayrollGridEditor = {
  canManage: boolean;
  /** Opens the reason dialog for a batch of rider-days. */
  onRequestAdjust: (cells: PayrollAdjustmentCell[]) => void;
  /** A refused paste or an empty selection is worth saying out loud. */
  onNotice?: (message: string) => void;
};

export function PayrollDayGrid({
  monthKey,
  days,
  rows,
  footer,
  exportLabel,
  onExport,
  empty,
  editor,
}: {
  monthKey: string;
  days: number;
  rows: readonly PayrollRiderRow[];
  footer: string;
  exportLabel: string;
  onExport: (rows: readonly PayrollRiderRow[]) => void;
  empty: string;
  editor?: PayrollGridEditor;
}) {
  const t = useTranslations("pages.payroll");
  const locale = useLocale();
  const parentRef = useRef<HTMLDivElement>(null);
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [sort, setSort] = useState<ColumnSort>(null);
  const [rect, setRect] = useState<CellRect | null>(null);

  const editable = Boolean(editor?.canManage);

  /** The row→column value map a filter or a sort reads, built once per change. */
  const valuesByRow = useMemo(() => {
    const map = new Map<string, Record<string, string | number | null>>();
    for (const row of rows) {
      const values: Record<string, string | number | null> = {};
      for (const column of RIDER_IDENTITY_COLUMNS) {
        values[column.id] = riderColumnValue(row, column.id);
      }
      for (const column of RIDER_TOTAL_COLUMNS) {
        values[column.id] = riderColumnValue(row, column.id);
      }
      for (let i = 0; i < days; i += 1) {
        values[dayColumnId(i)] = riderColumnValue(row, dayColumnId(i));
      }
      map.set(row.driverId, values);
    }
    return map;
  }, [rows, days]);

  const visibleRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      const values = valuesByRow.get(row.driverId);
      if (!values) return true;
      return rowMatchesColumnFilters(values, filters);
    });
    return sortByColumn(filtered, sort, (row, columnId) => riderColumnValue(row, columnId));
  }, [rows, filters, sort, valuesByRow]);

  const columns = useMemo(
    () => [...RIDER_IDENTITY_COLUMNS, ...RIDER_TOTAL_COLUMNS],
    [],
  );
  const dayColumnValues = useMemo(() => {
    const map = new Map<string, string[]>();
    for (let i = 0; i < days; i += 1) {
      const id = dayColumnId(i);
      const set = new Set<string>();
      for (const row of rows) {
        const value = riderColumnValue(row, id);
        if (typeof value === "string" && value) set.add(value);
      }
      map.set(id, [...set]);
    }
    return map;
  }, [rows, days]);

  const colCount = columns.length + days;
  const dayHeaders = Array.from({ length: days }, (_, i) => dayLabel(monthKey, i + 1, locale));
  const identityCount = RIDER_IDENTITY_COLUMNS.length;

  // ---- selection, fill and clipboard -----------------------------------

  const drag = useRef<{ mode: "select" | "fill"; r0: number; c0: number; r1: number; c1: number } | null>(
    null,
  );
  /**
   * The live rectangle. `endDrag` runs from a document listener that must not
   * read a stale closure or run a side effect inside a state updater, so the
   * gesture reads it from here and the state copy only drives the painting.
   */
  const rectRef = useRef<CellRect | null>(null);

  const commitCells = useCallback(
    (
      inputs: ReadonlyArray<{ driverId: string; date: string; text: string; currentHours?: number }>,
      emptyMessage: string,
    ) => {
      const { cells, rejected } = cellsFromSelection(
        inputs.map((cell) => ({
          driverId: cell.driverId,
          date: cell.date,
          text: cell.text,
          currentHours: cell.currentHours ?? 0,
        })),
      );
      if (!cells.length) {
        editor?.onNotice?.(emptyMessage);
        return;
      }
      if (rejected > 0) editor?.onNotice?.(t("adjust.someSkipped", { count: rejected }));
      editor?.onRequestAdjust(cells);
    },
    [editor, t],
  );

  const endDrag = useCallback(() => {
    const active = drag.current;
    drag.current = null;
    const current = rectRef.current;
    if (!active || active.mode !== "fill" || !current) return;

    // The fill handle repeats the source rectangle across the area dragged to,
    // which is what Excel does and what makes a 12-day OFF run one gesture.
    const width = active.c1 - active.c0 + 1;
    const height = active.r1 - active.r0 + 1;
    const inputs: Array<{ driverId: string; date: string; text: string; currentHours: number }> = [];
    for (let r = active.r0; r <= current.r1; r += 1) {
      for (let c = active.c0; c <= current.c1; c += 1) {
        if (r <= active.r1 && c <= active.c1) continue;
        const sourceRow = visibleRows[active.r0 + ((r - active.r0) % height)];
        const sourceDay = active.c0 + ((c - active.c0) % width) - identityCount;
        const targetRow = visibleRows[r];
        const targetDay = c - identityCount;
        if (!sourceRow || !targetRow) continue;
        if (sourceDay < 0 || sourceDay >= days || targetDay < 0 || targetDay >= days) continue;
        inputs.push({
          driverId: targetRow.driverId,
          date: isoDateInMonth(monthKey, targetDay + 1),
          text: dayClipboardToken(sourceRow, sourceDay),
          currentHours: targetRow.dayInfo[targetDay]?.creditedHours ?? 0,
        });
      }
    }
    commitCells(inputs, t("adjust.nothingFilled"));
  }, [visibleRows, days, identityCount, monthKey, commitCells, t]);

  useEffect(() => {
    rectRef.current = rect;
  }, [rect]);

  useEffect(() => {
    if (!editable) return;
    const onUp = () => endDrag();
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, [editable, endDrag]);

  const selectedCells = useMemo(() => {
    if (!rect) return [];
    const cells: Array<{ driverId: string; date: string; text: string; currentHours: number }> = [];
    for (let r = rect.r0; r <= rect.r1; r += 1) {
      const row = visibleRows[r];
      if (!row) continue;
      for (let c = rect.c0; c <= rect.c1; c += 1) {
        const dayIndex = c - identityCount;
        if (dayIndex < 0 || dayIndex >= days) continue;
        cells.push({
          driverId: row.driverId,
          date: isoDateInMonth(monthKey, dayIndex + 1),
          text: dayClipboardToken(row, dayIndex),
          currentHours: row.dayInfo[dayIndex]?.creditedHours ?? 0,
        });
      }
    }
    return cells;
  }, [rect, visibleRows, identityCount, days, monthKey]);

  const openSelection = useCallback(() => {
    if (!editable || !selectedCells.length) return;
    commitCells(selectedCells, t("adjust.nothingSelected"));
  }, [editable, selectedCells, commitCells, t]);

  const fillDown = useCallback(() => {
    if (!rect || !editable) return;
    const source = visibleRows[rect.r0];
    if (!source) return;
    const inputs: Array<{ driverId: string; date: string; text: string; currentHours: number }> = [];
    for (let r = rect.r0 + 1; r <= rect.r1; r += 1) {
      const row = visibleRows[r];
      if (!row) continue;
      for (let c = rect.c0; c <= rect.c1; c += 1) {
        const dayIndex = c - identityCount;
        if (dayIndex < 0 || dayIndex >= days) continue;
        inputs.push({
          driverId: row.driverId,
          date: isoDateInMonth(monthKey, dayIndex + 1),
          text: dayClipboardToken(source, dayIndex),
          currentHours: row.dayInfo[dayIndex]?.creditedHours ?? 0,
        });
      }
    }
    commitCells(inputs, t("adjust.nothingSelected"));
  }, [rect, editable, visibleRows, identityCount, days, monthKey, commitCells, t]);

  const paste = useCallback(async () => {
    const current = rectRef.current;
    if (!current || !editable) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        editor?.onNotice?.(t("adjust.nothingPasted"));
        return;
      }
      const matrix = text
        .replace(/\r/g, "")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => line.split("\t"));
      const inputs: Array<{ driverId: string; date: string; text: string; currentHours: number }> = [];
      for (let r = 0; r < matrix.length; r += 1) {
        const row = visibleRows[current.r0 + r];
        if (!row) break;
        for (let c = 0; c < matrix[r].length; c += 1) {
          const dayIndex = current.c0 - identityCount + c;
          if (dayIndex < 0 || dayIndex >= days) continue;
          inputs.push({
            driverId: row.driverId,
            date: isoDateInMonth(monthKey, dayIndex + 1),
            text: matrix[r][c],
            currentHours: row.dayInfo[dayIndex]?.creditedHours ?? 0,
          });
        }
      }
      commitCells(inputs, t("adjust.nothingPasted"));
    } catch {
      editor?.onNotice?.(t("adjust.pasteFailed"));
    }
  }, [editable, visibleRows, identityCount, days, monthKey, commitCells, editor, t]);

  const copy = useCallback(async () => {
    const current = rectRef.current;
    if (!current) return;
    const lines: string[] = [];
    for (let r = current.r0; r <= current.r1; r += 1) {
      const row = visibleRows[r];
      if (!row) continue;
      const line: string[] = [];
      for (let c = current.c0; c <= current.c1; c += 1) {
        const dayIndex = c - identityCount;
        line.push(dayIndex >= 0 && dayIndex < days ? dayClipboardToken(row, dayIndex) : "");
      }
      lines.push(line.join("\t"));
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      editor?.onNotice?.(t("adjust.copied", { count: lines.length }));
    } catch {
      editor?.onNotice?.(t("adjust.pasteFailed"));
    }
  }, [visibleRows, identityCount, days, editor, t]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!editable) return;
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === "Escape") {
      setRect(null);
      return;
    }
    if (mod && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void copy();
      return;
    }
    if (mod && event.key.toLowerCase() === "v") {
      event.preventDefault();
      void paste();
      return;
    }
    if (mod && event.key.toLowerCase() === "d") {
      event.preventDefault();
      fillDown();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      openSelection();
    }
  }

  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 16,
  });

  function rectBounds() {
    if (!rect) return null;
    return {
      top: Math.min(rect.r0, rect.r1),
      bottom: Math.max(rect.r0, rect.r1),
      left: Math.min(rect.c0, rect.c1),
      right: Math.max(rect.c0, rect.c1),
    };
  }

  const bounds = rectBounds();
  const isSelected = (r: number, c: number) =>
    Boolean(bounds && r >= bounds.top && r <= bounds.bottom && c >= bounds.left && c <= bounds.right);
  const labelOf = (columnId: string) => {
    const target = columnLabelTarget(columnId, days);
    if (target.kind === "rider") return t(`riderCols.${target.labelKey}`);
    if (target.kind === "day") return String(target.day);
    return columnId;
  };
  const filterChips = activeFilterChips(filters, labelOf);
  const hasFilters = filterChips.length > 0 || Boolean(sort);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {hasFilters ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <PayrollFilterChips
            chips={filterChips}
            onClear={() => {
              setFilters({});
              setSort(null);
            }}
            onRemove={(columnId) =>
              setFilters((prev) => {
                const next = { ...prev };
                delete next[columnId];
                return next;
              })
            }
            clearLabel={t("clearFilters")}
          />
          {sort ? (
            <span className="text-[11px] font-semibold text-muted-foreground">
              {t("sortedBy", { column: labelOf(sort.columnId) })}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        ref={parentRef}
        tabIndex={editable ? 0 : undefined}
        onKeyDown={onKeyDown}
        className={cn(
          "max-h-[min(520px,52dvh)] overflow-auto outline-none",
          editable && "focus-visible:ring-2 focus-visible:ring-primary/40",
        )}
      >
        <table className="w-max min-w-full border-collapse text-[12px]">
          <colgroup>
            {Array.from({ length: colCount }, (_, i) => (
              <col key={i} className={i >= identityCount && i < identityCount + days ? "min-w-[52px]" : undefined} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              {RIDER_IDENTITY_COLUMNS.map((column) => (
                <PayrollColumnHeader
                  key={column.id}
                  label={t(`riderCols.${column.labelKey}`)}
                  columnId={column.id}
                  values={rows.map((row) => String(riderColumnValue(row, column.id) ?? ""))}
                  filter={filters[column.id]}
                  onChange={(next) => setFiltersFor(setFilters, column.id, next)}
                  sort={sort}
                  onSort={setSort}
                  numeric={column.numeric}
                  className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}
                />
              ))}
              {dayHeaders.map((header, index) => (
                <PayrollColumnHeader
                  key={header}
                  label={header}
                  columnId={dayColumnId(index)}
                  values={dayColumnValues.get(dayColumnId(index)) ?? []}
                  filter={filters[dayColumnId(index)]}
                  onChange={(next) => setFiltersFor(setFilters, dayColumnId(index), next)}
                  sort={sort}
                  onSort={setSort}
                  className={cn(TABLE_HEAD_CLASS, "min-w-[52px] px-1 py-2 text-center")}
                />
              ))}
              {RIDER_TOTAL_COLUMNS.map((column) => (
                <PayrollColumnHeader
                  key={column.id}
                  label={t(`riderCols.${column.labelKey}`)}
                  columnId={column.id}
                  values={rows.map((row) => String(riderColumnValue(row, column.id) ?? ""))}
                  filter={filters[column.id]}
                  onChange={(next) => setFiltersFor(setFilters, column.id, next)}
                  sort={sort}
                  onSort={setSort}
                  numeric={column.numeric}
                  className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-3 py-8 text-center text-xs text-muted-foreground">
                  {empty}
                </td>
              </tr>
            ) : (
              <>
                {virtualizer.getVirtualItems().length > 0 ? (
                  <tr aria-hidden style={{ height: virtualizer.getVirtualItems()[0]?.start ?? 0 }}>
                    {spacerCells(colCount)}
                  </tr>
                ) : null}
                {virtualizer.getVirtualItems().map((item) => {
                  const row = visibleRows[item.index];
                  const eff = formatEfficiencyCell(row.efficiency);
                  const statusKey = row.status === "Active" ? "active" : "inactive";
                  return (
                    <tr key={row.driverId} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="whitespace-nowrap px-2 py-1.5">{row.amId}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{row.mgId}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 font-medium">{row.name}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{row.restaurant}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{row.zone}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        <ZoneCategoryPill category={row.zoneCategory} />
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">{row.partner}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{row.nationality}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            row.status === "Active"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-red-100 text-red-700",
                          )}
                        >
                          {t(`riderStatus.${statusKey}`)}
                        </span>
                      </td>
                      {row.days.map((st, i) => {
                        const columnIndex = identityCount + i;
                        const selected = isSelected(item.index, columnIndex);
                        const adjusted = Boolean(row.dayInfo[i]?.adjusted);
                        const info = row.dayInfo[i];
                        const label = st === "blank" ? "" : t(`dayStatus.${st}`);
                        return (
                          <td
                            key={`${row.driverId}-${i}`}
                            data-r={item.index}
                            data-c={columnIndex}
                            title={t("cellHint", {
                              status: label || "—",
                              hours: info?.creditedHours ?? 0,
                              orders: info?.orders ?? 0,
                              logged: info?.loggedHours ?? 0,
                            })}
                            onMouseDown={
                              editable
                                ? (event) => {
                                    if (event.button !== 0) return;
                                    event.preventDefault();
                                    const next = {
                                      r0: item.index,
                                      c0: columnIndex,
                                      r1: item.index,
                                      c1: columnIndex,
                                    };
                                    drag.current = { mode: "select", ...next };
                                    setRect(next);
                                  }
                                : undefined
                            }
                            onMouseEnter={
                              editable
                                ? () => {
                                    const active = drag.current;
                                    if (!active) return;
                                    setRect((current) =>
                                      current
                                        ? { ...current, r1: item.index, c1: columnIndex }
                                        : { r0: active.r0, c0: active.c0, r1: item.index, c1: columnIndex },
                                    );
                                  }
                                : undefined
                            }
                            onDoubleClick={editable ? () => openSelection() : undefined}
                            className={cn(
                              "relative min-w-[52px] px-1 py-1.5 text-center text-[11px] font-semibold select-none",
                              dayClass(st),
                              selected && "ring-2 ring-inset ring-primary/60",
                              adjusted && "ring-1 ring-inset ring-orange-400",
                            )}
                          >
                            {label}
                            {adjusted ? (
                              <span
                                aria-hidden
                                className="absolute end-0 top-0 size-1.5 rounded-es-sm bg-orange-500"
                              />
                            ) : null}
                            {editable && selected && bounds?.bottom === item.index && bounds?.right === columnIndex ? (
                              <span
                                role="presentation"
                                onMouseDown={(event) => {
                                  if (event.button !== 0) return;
                                  event.preventDefault();
                                  event.stopPropagation();
                                  if (!bounds) return;
                                  drag.current = {
                                    mode: "fill",
                                    r0: bounds.top,
                                    c0: bounds.left,
                                    r1: bounds.bottom,
                                    c1: bounds.right,
                                  };
                                }}
                                className="absolute -bottom-0.5 -end-0.5 size-2 cursor-crosshair rounded-[2px] border border-white bg-emerald-500"
                              />
                            ) : null}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5">{row.workDays}</td>
                      <td className="px-2 py-1.5">{row.totalHours}</td>
                      <td className="px-2 py-1.5">{row.offDays}</td>
                      <td className="px-2 py-1.5">{row.sickDays}</td>
                      <td className="px-2 py-1.5">{row.accidentDays}</td>
                      <td className="px-2 py-1.5">{row.reducedDays}</td>
                      <td className="px-2 py-1.5">{row.halfDays}</td>
                      <td className="px-2 py-1.5">{row.actualDays}</td>
                      <td className="px-2 py-1.5">{row.vehicleDays}</td>
                      <td className="px-2 py-1.5">{row.absLhDays}</td>
                      <td className="px-2 py-1.5">{row.absLoDays}</td>
                      <td className="px-2 py-1.5">{row.customDays}</td>
                      <td className="px-2 py-1.5">{row.absentDays}</td>
                      <td className="px-2 py-1.5">
                        {row.adjustedCells > 0 ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-orange-700">
                            {row.adjustedCells}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">{row.offStructureDays}</td>
                      <td className="px-2 py-1.5">{row.requiredHours.toFixed(1)}</td>
                      <td className="px-2 py-1.5">{row.actualHours.toFixed(2)}</td>
                      <td className="px-2 py-1.5">{row.finalOrders}</td>
                      <td
                        className={cn(
                          "px-2 py-1.5 font-semibold",
                          eff.tone === "good" && "text-emerald-700",
                          eff.tone === "bad" && "text-red-600",
                        )}
                      >
                        {eff.text}
                      </td>
                    </tr>
                  );
                })}
                {virtualizer.getVirtualItems().length > 0 ? (
                  <tr
                    aria-hidden
                    style={{
                      height: Math.max(
                        0,
                        virtualizer.getTotalSize() - (virtualizer.getVirtualItems().at(-1)?.end ?? 0),
                      ),
                    }}
                  >
                    {spacerCells(colCount)}
                  </tr>
                ) : null}
              </>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <span>{footer}</span>
        <div className="flex items-center gap-2">
          {editable ? <span>{t("adjust.gridHint")}</span> : null}
          <button
            type="button"
            onClick={() => onExport(visibleRows)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted/50"
          >
            <Download className="size-3.5" />
            {exportLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function setFiltersFor(
  setFilters: React.Dispatch<React.SetStateAction<ColumnFilters>>,
  columnId: string,
  next: ColumnFilters[string] | null,
) {
  setFilters((prev) => {
    const copy = { ...prev };
    if (!next || !columnFilterActive(next)) delete copy[columnId];
    else copy[columnId] = next;
    return copy;
  });
}

/** What a column id should be labelled as, without needing a translator here. */
type ColumnLabelTarget = { kind: "rider"; labelKey: string } | { kind: "day"; day: number } | { kind: "raw" };

function columnLabelTarget(columnId: string, days: number): ColumnLabelTarget {
  if (/^d\d+$/.test(columnId)) {
    const day = Number(columnId.slice(1));
    if (day >= 1 && day <= days) return { kind: "day", day };
    return { kind: "raw" };
  }
  const known = [...RIDER_IDENTITY_COLUMNS, ...RIDER_TOTAL_COLUMNS].find((c) => c.id === columnId);
  return known ? { kind: "rider", labelKey: known.labelKey } : { kind: "raw" };
}

export function ZoneCategoryPill({ category }: { category: string }) {
  const t = useTranslations("pages.payroll.zoneCategory");
  if (!category || category === "not_set") {
    return <span className="text-muted-foreground/60">{t("not_set")}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium">
      <span className="size-2.5 rounded-sm" style={{ background: categoryHex(category) }} />
      {t(category)}
    </span>
  );
}

function categoryHex(category: string): string {
  if (category === "good") return "#10b981";
  if (category === "average") return "#f59e0b";
  return "#ef4444";
}

/**
 * The read-only summary: identity + the rider totals, no day columns. Filter
 * and sort read from the same column list, so a column filtered here means the
 * same thing on the day grid.
 */
export function PayrollSummaryTable({
  rows,
  empty,
  exportLabel,
  onExport,
}: {
  rows: readonly PayrollRiderRow[];
  empty: string;
  exportLabel?: string;
  onExport?: (rows: readonly PayrollRiderRow[]) => void;
}) {
  const t = useTranslations("pages.payroll");
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [sort, setSort] = useState<ColumnSort>(null);
  const columns = useMemo(() => [...RIDER_IDENTITY_COLUMNS, ...RIDER_TOTAL_COLUMNS], []);

  const visibleRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      const values: Record<string, string | number | null> = {};
      for (const column of columns) values[column.id] = riderColumnValue(row, column.id);
      return rowMatchesColumnFilters(values, filters);
    });
    return sortByColumn(filtered, sort, (row, columnId) => riderColumnValue(row, columnId));
  }, [rows, filters, sort, columns]);

  const labelOf = (columnId: string) => {
    const target = columnLabelTarget(columnId, 0);
    return target.kind === "rider" ? t(`riderCols.${target.labelKey}`) : columnId;
  };
  const chips = activeFilterChips(filters, labelOf);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {chips.length ? (
        <div className="border-b border-border px-3 py-2">
          <PayrollFilterChips
            chips={chips}
            onClear={() => {
              setFilters({});
              setSort(null);
            }}
            onRemove={(columnId) =>
              setFilters((prev) => {
                const next = { ...prev };
                delete next[columnId];
                return next;
              })
            }
            clearLabel={t("clearFilters")}
          />
        </div>
      ) : null}
      <div className="max-h-[min(420px,46dvh)] overflow-auto">
        <table className="w-max min-w-full border-collapse text-[12px]">
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              {columns.map((column) => (
                <PayrollColumnHeader
                  key={column.id}
                  label={t(`riderCols.${column.labelKey}`)}
                  columnId={column.id}
                  values={rows.map((row) => String(riderColumnValue(row, column.id) ?? ""))}
                  filter={filters[column.id]}
                  onChange={(next) => setFiltersFor(setFilters, column.id, next)}
                  sort={sort}
                  onSort={setSort}
                  numeric={column.numeric}
                  className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-8 text-center text-xs text-muted-foreground"
                >
                  {empty}
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => {
                const eff = formatEfficiencyCell(row.efficiency);
                const statusKey = row.status === "Active" ? "active" : "inactive";
                return (
                  <tr key={row.driverId} className="border-b border-border/60 hover:bg-muted/30">
                    <td className="whitespace-nowrap px-2 py-1.5">{row.amId}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{row.mgId}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-medium">{row.name}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{row.restaurant}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{row.zone}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <ZoneCategoryPill category={row.zoneCategory} />
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">{row.partner}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{row.nationality}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          row.status === "Active"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-red-100 text-red-700",
                        )}
                      >
                        {t(`riderStatus.${statusKey}`)}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">{row.workDays}</td>
                    <td className="px-2 py-1.5">{row.totalHours}</td>
                    <td className="px-2 py-1.5">{row.offDays}</td>
                    <td className="px-2 py-1.5">{row.sickDays}</td>
                    <td className="px-2 py-1.5">{row.accidentDays}</td>
                    <td className="px-2 py-1.5">{row.reducedDays}</td>
                    <td className="px-2 py-1.5">{row.halfDays}</td>
                    <td className="px-2 py-1.5">{row.actualDays}</td>
                    <td className="px-2 py-1.5">{row.vehicleDays}</td>
                    <td className="px-2 py-1.5">{row.absLhDays}</td>
                    <td className="px-2 py-1.5">{row.absLoDays}</td>
                    <td className="px-2 py-1.5">{row.customDays}</td>
                    <td className="px-2 py-1.5">{row.absentDays}</td>
                    <td className="px-2 py-1.5">
                      {row.adjustedCells > 0 ? (
                        <span className="font-semibold text-orange-700">{row.adjustedCells}</span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">{row.offStructureDays}</td>
                    <td className="px-2 py-1.5">{row.requiredHours.toFixed(1)}</td>
                    <td className="px-2 py-1.5">{row.actualHours.toFixed(2)}</td>
                    <td className="px-2 py-1.5">{row.finalOrders}</td>
                    <td
                      className={cn(
                        "px-2 py-1.5 font-semibold",
                        eff.tone === "good" && "text-emerald-700",
                        eff.tone === "bad" && "text-red-600",
                      )}
                    >
                      {eff.text}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {onExport && exportLabel ? (
        <div className="flex justify-end border-t border-border px-3 py-2">
          <button
            type="button"
            onClick={() => onExport(visibleRows)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] font-semibold transition-colors hover:bg-muted/50"
          >
            <Download className="size-3.5" />
            {exportLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function PayrollLegend({
  riders,
  selected,
  onSelect,
}: {
  riders?: readonly PayrollRiderRow[];
  selected?: PayrollStatusFilter | null;
  onSelect?: (status: PayrollStatusFilter | null) => void;
}) {
  const t = useTranslations("pages.payroll");
  const counts = riders ? countRidersByStatus(riders) : null;
  const total = riders?.length ?? 0;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {PAYROLL_STATUS_FILTERS.map((id) => (
          <ToggleChip
            key={id}
            selected={selected === id}
            onClick={() => onSelect?.(selected === id ? null : id)}
            icon={PAYROLL_STATUS_ICONS[id]}
            leading={
              <span
                className="size-3.5 rounded-sm"
                style={{ background: PAYROLL_STATUS_CHIP[id].hex }}
              />
            }
          >
            {t(`legend.${id}`)}
            {counts ? ` · ${counts[id]}` : ""}
          </ToggleChip>
        ))}
      </div>
      {selected && counts ? (
        <div className="rounded-xl border border-emerald-400/50 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">
          {t("shareCard", {
            status: t(`legend.${selected}`),
            count: counts[selected],
            total,
            share: shareOfPayroll(counts[selected], total).toFixed(1),
          })}
        </div>
      ) : null}
    </div>
  );
}

/** `2026-09` + day index → `2026-09-14`. */
export function monthDate(monthKey: string, dayIndex: number): string {
  const day = dayIndex + 1;
  return `${monthKey}-${day < 10 ? "0" : ""}${day}`;
}

export { parseAdjustmentCellText, isNumericRiderColumn };
