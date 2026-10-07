"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslations } from "next-intl";
import {
  Ban,
  Briefcase,
  CalendarOff,
  Clock,
  Copy,
  Download,
  Eraser,
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
  countDaysByStatus,
  countedRiderDays,
  dayGridLabel,
  dayDisplayHours,
  isoDayLabel,
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
  COMBINED_IDENTITY_COLUMNS,
  dayAdjustmentInput,
  dayClipboardToken,
  dayColumnId,
  isNumericRiderColumn,
  PAYROLL_SUMMARY_COLUMNS,
  riderColumnValue,
  type PayrollRiderColumn,
} from "./payroll-rider-columns";
import { cellsFromSelection, fillTargetCells, tilePasteOntoSelection, visibleFillTargets } from "./payroll-snapshot";
import type { PayrollAdjustmentCell, PayrollRiderRow } from "./payroll-types";
import { PayrollCellMenu, type PayrollCellMenuState } from "./payroll-cell-menu";
import {
  columnHiddenIn,
  resolveColumnLabel,
  type PayrollColumnConfigRow,
} from "./payroll-column-config";
import { PayrollHeadingLabel, stickyIdentityOffset, stickyIdentityStyle } from "./payroll-heading";

export function dayClass(status: DayStatus): string {
  switch (status) {
    case "work":
      return "text-muted-foreground";
    case "reduced3":
      return "bg-amber-100 text-amber-900";
    case "half":
      return "bg-cyan-100 text-cyan-900";
    case "actual":
      return "bg-emerald-100 text-emerald-800";
    case "off":
      return "bg-emerald-100 text-emerald-800";
    case "sick":
      return "bg-orange-100 text-orange-800";
    case "accident":
      return "bg-lime-100 text-lime-800";
    case "vehicle":
      return "bg-indigo-100 text-indigo-800";
    case "absent":
      return "bg-red-100 text-red-700";
    case "abs_lh":
      return "bg-fuchsia-100 text-fuchsia-800";
    case "abs_lo":
      return "bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-300";
    case "custom":
      return "bg-purple-100 text-purple-800";
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

type CellRect = { r0: number; c0: number; r1: number; c1: number };

export type PayrollAdjustRequest = {
  cells: PayrollAdjustmentCell[];
  riderCount: number;
  dayCount: number;
  mode: "click" | "select" | "fill" | "paste";
  anchor: { top: number; left: number; width: number; height: number };
  anchorEl?: HTMLElement | null;
  auto: {
    status: DayStatus;
    hours: number;
    ruleIndex: number | null;
    ruleLabel: string | null;
  } | null;
  context: {
    riderName: string;
    amId: string;
    date: string;
    zone: string;
    zoneCategory: string;
    orders: number;
    hours: number;
  } | null;
  note?: string;
  /** Cell state before this batch, restored by one Undo. */
  before?: PayrollAdjustmentCell[];
};

export type PayrollGridEditor = {
  canManage: boolean;
  onRequestAdjust: (request: PayrollAdjustRequest) => void;
  onNotice?: (message: string) => void;
};

function stickyClass(index: number, head = false): string | undefined {
  const z = head ? "z-20" : "z-[2]";
  if (index === 0) return `sticky start-0 ${z} min-w-16 w-16 bg-card`;
  if (index === 1) return `sticky start-16 ${z} min-w-16 w-16 bg-card`;
  if (index === 2) return `sticky start-32 ${z} min-w-[190px] w-[190px] bg-card`;
  return undefined;
}

export function PayrollFillHandle({
  onMouseDown,
}: {
  onMouseDown: (event: React.MouseEvent<HTMLSpanElement>) => void;
}) {
  return (
    <span
      role="presentation"
      onMouseDown={onMouseDown}
      className="absolute -bottom-0.5 -end-0.5 size-2.5 cursor-crosshair rounded-[2px] border border-white bg-emerald-500 after:absolute after:-inset-2.5 after:content-['']"
    />
  );
}

function normalizeRect(rect: CellRect): { top: number; bottom: number; left: number; right: number } {
  return {
    top: Math.min(rect.r0, rect.r1),
    bottom: Math.max(rect.r0, rect.r1),
    left: Math.min(rect.c0, rect.c1),
    right: Math.max(rect.c0, rect.c1),
  };
}

export function PayrollDayGrid({
  dates,
  rows,
  footer,
  exportLabel,
  onExport,
  empty,
  editor,
  headingConfig,
  headingManage = false,
}: {
  dates: readonly string[];
  rows: readonly PayrollRiderRow[];
  footer: string;
  exportLabel: string;
  onExport: (rows: readonly PayrollRiderRow[]) => void;
  empty: string;
  editor?: PayrollGridEditor;
  headingConfig?: ReadonlyMap<string, PayrollColumnConfigRow>;
  headingManage?: boolean;
}) {
  const t = useTranslations("pages.payroll");
  const parentRef = useRef<HTMLDivElement>(null);
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [sort, setSort] = useState<ColumnSort>(null);
  const [rect, setRect] = useState<CellRect | null>(null);
  const [fillPreview, setFillPreview] = useState<CellRect | null>(null);
  const lastAnchor = useRef<DOMRect | null>(null);
  const lastAnchorEl = useRef<HTMLElement | null>(null);
  const [menu, setMenu] = useState<PayrollCellMenuState | null>(null);

  const editable = Boolean(editor?.canManage);
  const identity = useMemo(() => {
    if (!headingConfig) return COMBINED_IDENTITY_COLUMNS;
    return COMBINED_IDENTITY_COLUMNS.filter((column) => !columnHiddenIn(column.id, "combined", headingConfig));
  }, [headingConfig]);
  const days = dates.length;
  const identityCount = identity.length;

  const valuesByRow = useMemo(() => {
    const map = new Map<string, Record<string, string | number | null>>();
    for (const row of rows) {
      const values: Record<string, string | number | null> = {};
      for (const column of identity) values[column.id] = riderColumnValue(row, column.id);
      for (let i = 0; i < days; i += 1) {
        values[dayColumnId(i)] = riderColumnValue(row, dayColumnId(i));
      }
      map.set(row.driverId, values);
    }
    return map;
  }, [rows, days, identity]);

  const visibleRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      const values = valuesByRow.get(row.driverId);
      if (!values) return true;
      return rowMatchesColumnFilters(values, filters);
    });
    return sortByColumn(filtered, sort, (row, columnId) => riderColumnValue(row, columnId));
  }, [rows, filters, sort, valuesByRow]);

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

  const colCount = identityCount + days;
  const drag = useRef<{
    mode: "select" | "fill";
    r0: number;
    c0: number;
    r1: number;
    c1: number;
    rowIds: readonly string[];
  } | null>(null);
  const rectRef = useRef<CellRect | null>(null);

  const contextFor = useCallback(
    (row: PayrollRiderRow | undefined, dayIndex: number) => {
      if (!row) return null;
      const info = row.dayInfo[dayIndex];
      return {
        riderName: row.name,
        amId: row.amId,
        date: dates[dayIndex] ?? "",
        zone: row.zone,
        zoneCategory: row.zoneCategory,
        orders: info?.orders ?? 0,
        hours: info?.loggedHours ?? 0,
      };
    },
    [dates],
  );

  const autoFor = useCallback((row: PayrollRiderRow | undefined, dayIndex: number) => {
    const info = row?.dayInfo[dayIndex];
    if (!info) return null;
    return {
      status: info.autoStatus,
      hours: info.autoHours,
      ruleIndex: info.autoRuleIndex,
      ruleLabel: info.autoRuleLabel,
    };
  }, []);

  const openAdjust = useCallback(
    (
      inputs: ReadonlyArray<{
        driverId: string;
        date: string;
        text: string;
        currentHours?: number;
        beforeStatus?: PayrollAdjustmentCell["status"];
        beforeHours?: number | null;
      }>,
      mode: PayrollAdjustRequest["mode"],
      emptyMessage: string,
      first?: { row: PayrollRiderRow; dayIndex: number },
    ) => {
      const { cells, before, rejected } = cellsFromSelection(
        inputs.map((cell) => ({
          driverId: cell.driverId,
          date: cell.date,
          text: cell.text,
          currentHours: cell.currentHours ?? 0,
          beforeStatus: cell.beforeStatus,
          beforeHours: cell.beforeHours,
        })),
      );
      if (!cells.length) {
        editor?.onNotice?.(emptyMessage);
        return;
      }
      if (rejected > 0) editor?.onNotice?.(t("adjust.someSkipped", { count: rejected }));
      const ridersTouched = new Set(cells.map((c) => c.driverId));
      const datesTouched = new Set(cells.map((c) => c.date));
      const rect = lastAnchor.current ?? { top: 80, left: 80, width: 40, height: 28 };
      editor?.onRequestAdjust({
        cells,
        riderCount: ridersTouched.size,
        dayCount: datesTouched.size,
        mode,
        anchor: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        anchorEl: lastAnchorEl.current,
        before,
        auto: first ? autoFor(first.row, first.dayIndex) : null,
        context: first ? contextFor(first.row, first.dayIndex) : null,
        note: mode === "fill" || mode === "paste" ? t("adjust.patternNote") : undefined,
      });
    },
    [autoFor, contextFor, editor, t],
  );

  const endDrag = useCallback(() => {
    const active = drag.current;
    drag.current = null;
    const current = rectRef.current;
    if (!active || !current) {
      setFillPreview(null);
      return;
    }
    if (active.mode === "fill") {
      const inputs: ReturnType<typeof dayAdjustmentInput>[] = [];
      let first: { row: PayrollRiderRow; dayIndex: number } | undefined;
      const visibleIds = new Set(visibleRows.map((row) => row.driverId));
      const byId = new Map(visibleRows.map((row) => [row.driverId, row]));
      for (const target of visibleFillTargets(
        fillTargetCells(
          { r0: active.r0, c0: active.c0, r1: active.r1, c1: active.c1 },
          current.r1,
          current.c1,
        ),
        active.rowIds,
        visibleIds,
      )) {
        const sourceRow = byId.get(active.rowIds[target.srcR] ?? "");
        const sourceDay = target.srcC - identityCount;
        const targetRow = byId.get(active.rowIds[target.r] ?? "");
        const targetDay = target.c - identityCount;
        if (!sourceRow || !targetRow) continue;
        if (sourceDay < 0 || sourceDay >= days || targetDay < 0 || targetDay >= days) continue;
        inputs.push(
          dayAdjustmentInput(targetRow, targetDay, dates[targetDay] ?? "", dayClipboardToken(sourceRow, sourceDay)),
        );
        first ??= { row: targetRow, dayIndex: targetDay };
      }
      setFillPreview(null);
      openAdjust(inputs, "fill", t("adjust.nothingFilled"), first);
      return;
    }
    const moved = current.r0 !== current.r1 || current.c0 !== current.c1;
    const bounds = normalizeRect(current);
    const inputs: ReturnType<typeof dayAdjustmentInput>[] = [];
    let first: { row: PayrollRiderRow; dayIndex: number } | undefined;
    const byId = new Map(visibleRows.map((row) => [row.driverId, row]));
    for (let r = bounds.top; r <= bounds.bottom; r += 1) {
      const row = byId.get(active.rowIds[r] ?? "");
      if (!row) continue;
      for (let c = bounds.left; c <= bounds.right; c += 1) {
        const dayIndex = c - identityCount;
        if (dayIndex < 0 || dayIndex >= days) continue;
        inputs.push(dayAdjustmentInput(row, dayIndex, dates[dayIndex] ?? ""));
        first ??= { row, dayIndex };
      }
    }
    openAdjust(inputs, moved ? "select" : "click", t("adjust.nothingSelected"), first);
  }, [visibleRows, days, identityCount, dates, openAdjust, t]);

  useEffect(() => {
    rectRef.current = rect;
  }, [rect]);

  useEffect(() => {
    if (!editable) return;
    const onUp = () => endDrag();
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, [editable, endDrag]);

  const selectedMeta = useMemo(() => {
    if (!rect) return null;
    const bounds = normalizeRect(rect);
    const riderIds = new Set<string>();
    const dayIds = new Set<number>();
    let count = 0;
    for (let r = bounds.top; r <= bounds.bottom; r += 1) {
      const row = visibleRows[r];
      if (!row) continue;
      for (let c = bounds.left; c <= bounds.right; c += 1) {
        const dayIndex = c - identityCount;
        if (dayIndex < 0 || dayIndex >= days) continue;
        riderIds.add(row.driverId);
        dayIds.add(dayIndex);
        count += 1;
      }
    }
    return { count, riders: riderIds.size, days: dayIds.size };
  }, [rect, visibleRows, identityCount, days]);

  const copy = useCallback(async () => {
    const current = rectRef.current;
    if (!current) return;
    const bounds = normalizeRect(current);
    const lines: string[] = [];
    for (let r = bounds.top; r <= bounds.bottom; r += 1) {
      const row = visibleRows[r];
      if (!row) continue;
      const line: string[] = [];
      for (let c = bounds.left; c <= bounds.right; c += 1) {
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
      const bounds = normalizeRect(current);
      const selRows = bounds.bottom - bounds.top + 1;
      const selCols = bounds.right - bounds.left + 1;
      const tiled = tilePasteOntoSelection(matrix, selRows, selCols);
      const inputs: ReturnType<typeof dayAdjustmentInput>[] = [];
      let first: { row: PayrollRiderRow; dayIndex: number } | undefined;
      for (let r = 0; r < tiled.length; r += 1) {
        const row = visibleRows[bounds.top + r];
        if (!row) break;
        for (let c = 0; c < tiled[r].length; c += 1) {
          const dayIndex = bounds.left - identityCount + c;
          if (dayIndex < 0 || dayIndex >= days) continue;
          inputs.push(dayAdjustmentInput(row, dayIndex, dates[dayIndex] ?? "", tiled[r][c]));
          first ??= { row, dayIndex };
        }
      }
      openAdjust(inputs, "paste", t("adjust.nothingPasted"), first);
    } catch {
      editor?.onNotice?.(t("adjust.pasteFailed"));
    }
  }, [editable, visibleRows, identityCount, days, dates, openAdjust, editor, t]);

  const fillDown = useCallback(() => {
    if (!rect || !editable) return;
    const bounds = normalizeRect(rect);
    const source = visibleRows[bounds.top];
    if (!source) return;
    const inputs: ReturnType<typeof dayAdjustmentInput>[] = [];
    let first: { row: PayrollRiderRow; dayIndex: number } | undefined;
    for (let r = bounds.top + 1; r <= bounds.bottom; r += 1) {
      const row = visibleRows[r];
      if (!row) continue;
      for (let c = bounds.left; c <= bounds.right; c += 1) {
        const dayIndex = c - identityCount;
        if (dayIndex < 0 || dayIndex >= days) continue;
        inputs.push(dayAdjustmentInput(row, dayIndex, dates[dayIndex] ?? "", dayClipboardToken(source, dayIndex)));
        first ??= { row, dayIndex };
      }
    }
    openAdjust(inputs, "fill", t("adjust.nothingSelected"), first);
  }, [rect, editable, visibleRows, identityCount, days, dates, openAdjust, t]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!editable) return;
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === "Escape") {
      setRect(null);
      setFillPreview(null);
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
    }
  }

  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 16,
  });

  const bounds = rect ? normalizeRect(rect) : null;
  const fillBounds = fillPreview ? normalizeRect(fillPreview) : null;
  const isSelected = (r: number, c: number) =>
    Boolean(bounds && r >= bounds.top && r <= bounds.bottom && c >= bounds.left && c <= bounds.right);
  const isFillTarget = (r: number, c: number) =>
    Boolean(
      fillBounds &&
        r >= fillBounds.top &&
        r <= fillBounds.bottom &&
        c >= fillBounds.left &&
        c <= fillBounds.right &&
        !isSelected(r, c),
    );

  const labelOf = (columnId: string) => {
    const known = COMBINED_IDENTITY_COLUMNS.find((c) => c.id === columnId);
    if (known) {
      const fallback = t(`riderCols.${known.labelKey}`);
      return headingConfig ? resolveColumnLabel(columnId, fallback, headingConfig) : fallback;
    }
    if (/^d\d+$/.test(columnId)) {
      const index = Number(columnId.slice(1)) - 1;
      return dates[index] ? isoDayLabel(dates[index]) : columnId;
    }
    return columnId;
  };
  const filterChips = activeFilterChips(filters, labelOf);
  const hasFilters = filterChips.length > 0 || Boolean(sort);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {hasFilters ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <PayrollFilterChips
            prefix={t("columnFiltersPrefix")}
            chips={filterChips}
            sortLabel={
              sort
                ? t("sortedBy", {
                    column: labelOf(sort.columnId),
                    dir: sort.dir === "asc" ? t("sortAsc") : t("sortDesc"),
                  })
                : null
            }
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
            clearLabel={t("clearColumnFilters")}
          />
        </div>
      ) : null}
      {editable && selectedMeta ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-3 py-2 text-[11px]">
          <span className="font-semibold">
            {t("adjust.selectionBar", {
              cells: selectedMeta.count,
              riders: selectedMeta.riders,
              days: selectedMeta.days,
            })}
          </span>
          <button type="button" className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 font-semibold hover:bg-muted/50" onClick={() => void copy()}>
            <Copy className="size-3" />
            {t("adjust.copy")}
          </button>
          <button type="button" className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 font-semibold hover:bg-muted/50" onClick={() => void paste()}>
            {t("adjust.paste")}
          </button>
          <button type="button" className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 font-semibold hover:bg-muted/50" onClick={fillDown}>
            {t("adjust.fillDown")}
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 font-semibold text-destructive hover:bg-destructive/10"
            onClick={() => setRect(null)}
          >
            <Eraser className="size-3" />
            {t("adjust.clearSelection")}
          </button>
          <span className="ms-auto text-muted-foreground">{t("adjust.gridHint")}</span>
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
              <col key={i} className={i >= identityCount ? "min-w-[52px]" : undefined} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              {identity.map((column, index) => {
                const fallback = t(`riderCols.${column.labelKey}`);
                const sticky = headingConfig
                  ? stickyIdentityStyle(
                      column.id,
                      identity.slice(0, index).reduce((sum, col) => sum + stickyIdentityOffset(col.id), 0),
                    )
                  : null;
                return (
                <PayrollColumnHeader
                  key={column.id}
                  label={headingConfig ? resolveColumnLabel(column.id, fallback, headingConfig) : fallback}
                  heading={
                    headingConfig ? (
                      <PayrollHeadingLabel
                        columnKey={column.id}
                        fallback={fallback}
                        config={headingConfig}
                        canManage={headingManage}
                      />
                    ) : undefined
                  }
                  columnId={column.id}
                  values={rows.map((row) => String(riderColumnValue(row, column.id) ?? ""))}
                  filter={filters[column.id]}
                  onChange={(next) => setFiltersFor(setFilters, column.id, next)}
                  sort={sort}
                  onSort={setSort}
                  numeric={column.numeric}
                  className={cn(TABLE_HEAD_CLASS, "px-2 py-2", sticky?.className ?? stickyClass(index, true))}
                  style={sticky?.style}
                />
                );
              })}
              {dates.map((date, index) => (
                <PayrollColumnHeader
                  key={date}
                  label={isoDayLabel(date)}
                  columnId={dayColumnId(index)}
                  values={dayColumnValues.get(dayColumnId(index)) ?? []}
                  filter={filters[dayColumnId(index)]}
                  onChange={(next) => setFiltersFor(setFilters, dayColumnId(index), next)}
                  sort={sort}
                  onSort={setSort}
                  className={cn(TABLE_HEAD_CLASS, "min-w-[52px] px-1 py-2 text-center")}
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
                  return (
                    <tr key={row.driverId} className="border-b border-border/60 hover:bg-muted/30">
                      {identity.map((column, index) => {
                        const sticky = headingConfig
                          ? stickyIdentityStyle(
                              column.id,
                              identity.slice(0, index).reduce((sum, col) => sum + stickyIdentityOffset(col.id), 0),
                            )
                          : null;
                        return (
                        <td
                          key={column.id}
                          className={cn(
                            "whitespace-nowrap px-2 py-1.5",
                            sticky?.className ?? stickyClass(index),
                            column.id === "name" && "font-medium",
                          )}
                          style={sticky?.style}
                        >
                          {renderIdentityCell(row, column)}
                        </td>
                        );
                      })}
                      {dates.map((date, i) => {
                        const columnIndex = identityCount + i;
                        const selected = isSelected(item.index, columnIndex);
                        const st = row.days[i] ?? "blank";
                        const info = row.dayInfo[i];
                        const adjusted = Boolean(info?.adjusted);
                        const label =
                          st === "blank" ? "" : dayGridLabel(st, dayDisplayHours(st, info));
                        return (
                          <td
                            key={`${row.driverId}-${date}`}
                            data-r={item.index}
                            data-c={columnIndex}
                            title={t("cellHint", {
                              status: label || "—",
                              hours: info?.creditedHours ?? 0,
                              orders: info?.orders ?? 0,
                              // A still-open check-in has elapsed hours but no
                              // logged total yet; the hint must not read `0h
                              // logged` beside a cell that prints 0.8h.
                              logged: info?.loggedHours || (info?.elapsedHours ?? 0),
                            })}
                            onContextMenu={
                              editable
                                ? (event) => {
                                    event.preventDefault();
                                    lastAnchor.current = event.currentTarget.getBoundingClientRect();
                                    lastAnchorEl.current = event.currentTarget;
                                    setMenu({
                                      x: event.clientX,
                                      y: event.clientY,
                                      driverId: row.driverId,
                                      date,
                                    });
                                  }
                                : undefined
                            }
                            onMouseDown={
                              editable
                                ? (event) => {
                                    if (event.button !== 0) return;
                                    event.preventDefault();
                                    lastAnchor.current = event.currentTarget.getBoundingClientRect();
                                    lastAnchorEl.current = event.currentTarget;
                                    const next = {
                                      r0: item.index,
                                      c0: columnIndex,
                                      r1: item.index,
                                      c1: columnIndex,
                                    };
                                    drag.current = {
                                      mode: "select",
                                      ...next,
                                      rowIds: visibleRows.map((item) => item.driverId),
                                    };
                                    setRect(next);
                                    setFillPreview(null);
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
                                    if (active.mode === "fill") {
                                      setFillPreview({
                                        r0: Math.min(active.r0, item.index),
                                        c0: Math.min(active.c0, columnIndex),
                                        r1: Math.max(active.r1, item.index),
                                        c1: Math.max(active.c1, columnIndex),
                                      });
                                    }
                                  }
                                : undefined
                            }
                        className={cn(
                              "relative min-w-[52px] px-1 py-1.5 text-center text-[11px] font-semibold select-none",
                              dayClass(st),
                              selected && "ring-2 ring-inset ring-primary/60",
                              isFillTarget(item.index, columnIndex) && "outline-dashed outline-1 outline-emerald-500",
                              adjusted && "outline outline-2 outline-orange-400",
                            )}
                          >
                            {label}
                            {adjusted ? (
                              <span
                                aria-hidden
                                className="absolute end-0 top-0 size-0 border-e-[6px] border-t-[6px] border-e-transparent border-t-orange-500"
                              />
                            ) : null}
                            {editable && selected && bounds?.bottom === item.index && bounds?.right === columnIndex ? (
                              <PayrollFillHandle
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
                                    rowIds: visibleRows.map((item) => item.driverId),
                                  };
                                }}
                              />
                            ) : null}
                      </td>
                        );
                      })}
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
        <button
          type="button"
          onClick={() => onExport(visibleRows)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted/50"
        >
          <Download className="size-3.5" />
          {exportLabel}
        </button>
      </div>
      <PayrollCellMenu
        state={menu}
        onClose={() => setMenu(null)}
        onEdit={() => {
          if (!menu) return;
          const rowIndex = visibleRows.findIndex((row) => row.driverId === menu.driverId);
          const dayIndex = dates.indexOf(menu.date);
          const row = visibleRows[rowIndex];
          setMenu(null);
          if (!row || dayIndex < 0) return;
          openAdjust(
            [
              {
                driverId: row.driverId,
                date: menu.date,
                text: dayClipboardToken(row, dayIndex),
                currentHours: row.dayInfo[dayIndex]?.creditedHours ?? 0,
              },
            ],
            "click",
            t("adjust.nothingSelected"),
            { row, dayIndex },
          );
        }}
        onHistory={() => {
          if (!menu) return;
          const rowIndex = visibleRows.findIndex((row) => row.driverId === menu.driverId);
          const dayIndex = dates.indexOf(menu.date);
          const row = visibleRows[rowIndex];
          setMenu(null);
          if (!row || dayIndex < 0) return;
          openAdjust(
            [
              {
                driverId: row.driverId,
                date: menu.date,
                text: dayClipboardToken(row, dayIndex),
                currentHours: row.dayInfo[dayIndex]?.creditedHours ?? 0,
              },
            ],
            "click",
            t("adjust.nothingSelected"),
            { row, dayIndex },
          );
        }}
      />
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

function renderIdentityCell(row: PayrollRiderRow, column: PayrollRiderColumn) {
  if (column.id === "zoneCategory") return <ZoneCategoryPill category={row.zoneCategory} />;
  const value = riderColumnValue(row, column.id);
  return value == null || value === "" ? "—" : String(value);
}

function renderSummaryCell(row: PayrollRiderRow, column: PayrollRiderColumn) {
  if (column.id === "zoneCategory") return <ZoneCategoryPill category={row.zoneCategory} />;
  if (column.id === "status") {
    const active = row.status === "Active";
    return (
      <span
        className={cn(
          "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold",
          active ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700",
        )}
      >
        {row.status}
      </span>
    );
  }
  if (column.id === "efficiency" || column.id === "zoneEff") {
    const raw = column.id === "efficiency" ? row.efficiency : row.zoneEfficiency;
    if (raw == null) return <span className="text-muted-foreground/50">—</span>;
    const eff = formatEfficiencyCell(raw);
    return (
      <span
        className={cn(
          "font-semibold",
          eff.tone === "good" && "text-emerald-700",
          eff.tone === "bad" && "text-red-600",
        )}
      >
        {eff.text}
      </span>
    );
  }
  if (column.id === "reduced3") {
    return row.reducedDays > 0 ? (
      <span className="inline-flex rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
        {row.reducedDays}
      </span>
    ) : (
      0
    );
  }
  const value = riderColumnValue(row, column.id);
  if (value == null || value === "") return <span className="text-muted-foreground/50">—</span>;
  if (typeof value === "number" && (column.id === "requiredHours" || column.id === "actualHours" || column.id === "zoneDpd")) {
    return value.toFixed(column.id === "actualHours" ? 2 : 1);
  }
  return String(value);
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

export function PayrollSummaryTable({
  rows,
  empty,
  exportLabel,
  onExport,
  rangeLabel,
}: {
  rows: readonly PayrollRiderRow[];
  empty: string;
  exportLabel?: string;
  onExport?: (rows: readonly PayrollRiderRow[]) => void;
  rangeLabel?: string;
}) {
  const t = useTranslations("pages.payroll");
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [sort, setSort] = useState<ColumnSort>(null);
  const columns = PAYROLL_SUMMARY_COLUMNS;

  const visibleRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      const values: Record<string, string | number | null> = {};
      for (const column of columns) values[column.id] = riderColumnValue(row, column.id);
      return rowMatchesColumnFilters(values, filters);
    });
    return sortByColumn(filtered, sort, (row, columnId) => riderColumnValue(row, columnId));
  }, [rows, filters, sort, columns]);

  const labelOf = (columnId: string) => {
    const known = columns.find((c) => c.id === columnId);
    return known ? t(`riderCols.${known.labelKey}`) : columnId;
  };
  const chips = activeFilterChips(filters, labelOf);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {chips.length || sort ? (
        <div className="border-b border-border px-3 py-2">
          <PayrollFilterChips
            prefix={t("columnFiltersPrefix")}
            chips={chips}
            sortLabel={
              sort
                ? t("sortedBy", {
                    column: labelOf(sort.columnId),
                    dir: sort.dir === "asc" ? t("sortAsc") : t("sortDesc"),
                  })
                : null
            }
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
            clearLabel={t("clearColumnFilters")}
          />
        </div>
      ) : null}
      <div className="max-h-[min(420px,46dvh)] overflow-auto">
        <table className="w-max min-w-full border-collapse text-[12px]">
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              {columns.map((column, index) => (
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
                  className={cn(TABLE_HEAD_CLASS, "px-2 py-2", stickyClass(index, true))}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-xs text-muted-foreground">
                  {empty}
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => (
                <tr key={row.driverId} className="border-b border-border/60 hover:bg-muted/30">
                  {columns.map((column, index) => (
                    <td
                      key={column.id}
                      className={cn("whitespace-nowrap px-2 py-1.5", stickyClass(index), index === 2 && "font-medium")}
                    >
                      {renderSummaryCell(row, column)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {onExport && exportLabel ? (
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
          <p className="text-[11px] text-muted-foreground">
            {t("tableFootRange", {
              shown: visibleRows.length,
              total: rows.length,
              range: rangeLabel ?? "",
            })}
          </p>
          <button
            type="button"
            onClick={() => onExport(visibleRows)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] font-semibold transition-colors hover:bg-muted/50"
          >
            <Download className="size-3.5" />
            {exportLabel}
          </button>
        </div>
      ) : (
        <div className="border-t border-border px-3 py-2">
          <p className="text-[11px] text-muted-foreground">
            {t("tableFootRange", {
              shown: visibleRows.length,
              total: rows.length,
              range: rangeLabel ?? "",
            })}
          </p>
        </div>
      )}
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
  const counts = riders ? countDaysByStatus(riders) : null;
  const total = riders ? countedRiderDays(riders) : 0;
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
              <span className="size-3.5 rounded-sm" style={{ background: PAYROLL_STATUS_CHIP[id].hex }} />
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

export { isNumericRiderColumn };
