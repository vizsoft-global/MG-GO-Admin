"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Info } from "lucide-react";
import { TABLE_HEAD_CLASS } from "@/components/app";
import { SearchField } from "@/components/app";
import { cn } from "@/lib/utils";
import {
  isoDayLabel,
  payrollRiderMatchesSearch,
  type PayrollPeriod,
} from "./payroll-formulas";
import { exportPayrollAttendanceOrdersCsv } from "./payroll-csv";
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
  AO_LEAD_COLUMNS,
  dayClipboardToken,
  dayColumnId,
  dayOrdersColumnId,
  riderColumnValue,
} from "./payroll-rider-columns";
import { dayClass, PayrollFillHandle, PayrollLegend, ZoneCategoryPill } from "./payroll-grid";
import { AdjustmentDialog } from "./adjustment-dialog";
import { PayrollCellMenu, type PayrollCellMenuState } from "./payroll-cell-menu";
import {
  columnHiddenIn,
  configByKey,
  exportLabelsFromConfig,
  hiddenSetFor,
  resolveColumnLabel,
} from "./payroll-column-config";
import { PayrollColumnsMenu, PayrollHeadingLabel, stickyIdentityOffset, stickyIdentityStyle } from "./payroll-heading";
import { cellParticular } from "./payroll-particulars";
import { fillTargetCells, tilePasteOntoSelection } from "./payroll-snapshot";
import type { PayrollRiderRow } from "./payroll-types";
import { usePayrollAdjustSession } from "./use-payroll-adjust";
import { usePayrollColumnConfig } from "./use-payroll";

type CellRect = { r0: number; c0: number; r1: number; c1: number };

function normalizeRect(rect: CellRect) {
  return {
    top: Math.min(rect.r0, rect.r1),
    bottom: Math.max(rect.r0, rect.r1),
    left: Math.min(rect.c0, rect.c1),
    right: Math.max(rect.c0, rect.c1),
  };
}

export function PayrollAttendanceOrdersTab({
  month,
  riders,
  canExport,
  canManage = false,
}: {
  month: PayrollPeriod;
  riders: readonly PayrollRiderRow[];
  canExport: boolean;
  canManage?: boolean;
}) {
  const t = useTranslations("pages.payroll");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [sort, setSort] = useState<ColumnSort>(null);
  const [rect, setRect] = useState<CellRect | null>(null);
  const [fillPreview, setFillPreview] = useState<CellRect | null>(null);
  const [menu, setMenu] = useState<PayrollCellMenuState | null>(null);
  const drag = useRef<{ mode: "select" | "fill"; r0: number; c0: number; r1: number; c1: number } | null>(null);
  const rectRef = useRef<CellRect | null>(null);
  const session = usePayrollAdjustSession();
  const headings = usePayrollColumnConfig();
  const headingConfig = useMemo(() => configByKey(headings.data), [headings.data]);
  const columns = useMemo(
    () => AO_LEAD_COLUMNS.filter((column) => !columnHiddenIn(column.id, "ao", headingConfig)),
    [headingConfig],
  );
  const dates = month.dates;
  const editable = canManage;

  const searched = useMemo(
    () => riders.filter((r) => payrollRiderMatchesSearch(r, search)),
    [riders, search],
  );

  const visibleRows = useMemo(() => {
    const filtered = searched.filter((row) => {
      const values: Record<string, string | number | null> = {};
      for (const column of AO_LEAD_COLUMNS) values[column.id] = riderColumnValue(row, column.id);
      for (let i = 0; i < dates.length; i += 1) {
        values[dayColumnId(i)] = riderColumnValue(row, dayColumnId(i));
        values[dayOrdersColumnId(i)] = riderColumnValue(row, dayOrdersColumnId(i));
      }
      return rowMatchesColumnFilters(values, filters);
    });
    return sortByColumn(filtered, sort, (row, columnId) => riderColumnValue(row, columnId));
  }, [searched, filters, sort, dates.length]);

  const fallbackLabel = useCallback((key: string) => t(`riderCols.${key}`), [t]);

  const labelOf = (columnId: string) => {
    const riderColumn = AO_LEAD_COLUMNS.find((c) => c.id === columnId);
    if (riderColumn) return resolveColumnLabel(columnId, t(`riderCols.${riderColumn.labelKey}`), headingConfig);
    const dayMatch = /^([do])(\d+)$/.exec(columnId);
    if (dayMatch) {
      const date = dates[Number(dayMatch[2]) - 1];
      const label = date ? isoDayLabel(date) : columnId;
      return dayMatch[1] === "o" ? t("ao.ordersColumn", { day: label }) : t("ao.payrollColumn", { day: label });
    }
    return columnId;
  };
  const chips = activeFilterChips(filters, labelOf);

  function setFilter(columnId: string, next: ColumnFilters[string] | null) {
    setFilters((prev) => {
      const copy = { ...prev };
      if (!next || !columnFilterActive(next)) delete copy[columnId];
      else copy[columnId] = next;
      return copy;
    });
  }

  const dayValues = useMemo(() => {
    const map = new Map<string, string[]>();
    for (let i = 0; i < dates.length; i += 1) {
      const statusId = dayColumnId(i);
      const ordersId = dayOrdersColumnId(i);
      const statusSet = new Set<string>();
      const orderSet = new Set<string>();
      for (const row of riders) {
        const status = riderColumnValue(row, statusId);
        if (typeof status === "string" && status) statusSet.add(status);
        const orders = riderColumnValue(row, ordersId);
        if (orders !== null) orderSet.add(String(orders));
      }
      map.set(statusId, [...statusSet]);
      map.set(ordersId, [...orderSet]);
    }
    return map;
  }, [riders, dates.length]);

  const columnCount = columns.length + dates.length * 2;

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

  const openFor = useCallback(
    (
      inputs: ReadonlyArray<{ driverId: string; date: string; text: string; currentHours: number }>,
      mode: "click" | "select" | "fill" | "paste",
      empty: string,
      first?: { row: PayrollRiderRow; dayIndex: number },
    ) => {
      session.openAdjust(inputs, mode, empty, first, {
        auto: first ? autoFor(first.row, first.dayIndex) : null,
        context: first ? contextFor(first.row, first.dayIndex) : null,
      });
    },
    [autoFor, contextFor, session],
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
      const inputs: Array<{ driverId: string; date: string; text: string; currentHours: number }> = [];
      let first: { row: PayrollRiderRow; dayIndex: number } | undefined;
      for (const target of fillTargetCells(
        { r0: active.r0, c0: active.c0, r1: active.r1, c1: active.c1 },
        current.r1,
        current.c1,
      )) {
        const sourceRow = visibleRows[target.srcR];
        const targetRow = visibleRows[target.r];
        if (!sourceRow || !targetRow) continue;
        if (target.srcC < 0 || target.srcC >= dates.length || target.c < 0 || target.c >= dates.length) continue;
        inputs.push({
          driverId: targetRow.driverId,
          date: dates[target.c] ?? "",
          text: dayClipboardToken(sourceRow, target.srcC),
          currentHours: targetRow.dayInfo[target.c]?.creditedHours ?? 0,
        });
        first ??= { row: targetRow, dayIndex: target.c };
      }
      setFillPreview(null);
      openFor(inputs, "fill", t("adjust.nothingFilled"), first);
      return;
    }
    const moved = current.r0 !== current.r1 || current.c0 !== current.c1;
    const bounds = normalizeRect(current);
    const inputs: Array<{ driverId: string; date: string; text: string; currentHours: number }> = [];
    let first: { row: PayrollRiderRow; dayIndex: number } | undefined;
    for (let r = bounds.top; r <= bounds.bottom; r += 1) {
      const row = visibleRows[r];
      if (!row) continue;
      for (let c = bounds.left; c <= bounds.right; c += 1) {
        if (c < 0 || c >= dates.length) continue;
        inputs.push({
          driverId: row.driverId,
          date: dates[c] ?? "",
          text: dayClipboardToken(row, c),
          currentHours: row.dayInfo[c]?.creditedHours ?? 0,
        });
        first ??= { row, dayIndex: c };
      }
    }
    openFor(inputs, moved ? "select" : "click", t("adjust.nothingSelected"), first);
  }, [visibleRows, dates, openFor, t]);

  useEffect(() => {
    rectRef.current = rect;
  }, [rect]);

  useEffect(() => {
    if (!editable) return;
    const onUp = () => endDrag();
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, [editable, endDrag]);

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

  const copy = useCallback(async () => {
    const current = rectRef.current;
    if (!current) return;
    const box = normalizeRect(current);
    const lines: string[] = [];
    for (let r = box.top; r <= box.bottom; r += 1) {
      const row = visibleRows[r];
      if (!row) continue;
      const line: string[] = [];
      for (let c = box.left; c <= box.right; c += 1) {
        line.push(c >= 0 && c < dates.length ? dayClipboardToken(row, c) : "");
      }
      lines.push(line.join("\t"));
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      session.onNotice(t("adjust.copied", { count: lines.length }));
    } catch {
      session.onNotice(t("adjust.pasteFailed"));
    }
  }, [visibleRows, dates.length, session, t]);

  const paste = useCallback(async () => {
    const current = rectRef.current;
    if (!current || !editable) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        session.onNotice(t("adjust.nothingPasted"));
        return;
      }
      const matrix = text
        .replace(/\r/g, "")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => line.split("\t"));
      const box = normalizeRect(current);
      const tiled = tilePasteOntoSelection(matrix, box.bottom - box.top + 1, box.right - box.left + 1);
      const inputs: Array<{ driverId: string; date: string; text: string; currentHours: number }> = [];
      let first: { row: PayrollRiderRow; dayIndex: number } | undefined;
      for (let r = 0; r < tiled.length; r += 1) {
        const row = visibleRows[box.top + r];
        if (!row) break;
        for (let c = 0; c < tiled[r].length; c += 1) {
          const dayIndex = box.left + c;
          if (dayIndex < 0 || dayIndex >= dates.length) continue;
          inputs.push({
            driverId: row.driverId,
            date: dates[dayIndex] ?? "",
            text: tiled[r][c],
            currentHours: row.dayInfo[dayIndex]?.creditedHours ?? 0,
          });
          first ??= { row, dayIndex };
        }
      }
      openFor(inputs, "paste", t("adjust.nothingPasted"), first);
    } catch {
      session.onNotice(t("adjust.pasteFailed"));
    }
  }, [editable, visibleRows, dates, openFor, session, t]);

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
    }
    if (mod && event.key.toLowerCase() === "v") {
      event.preventDefault();
      void paste();
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-[12px] leading-5 shadow-sm">
          <b>{t("ao.bannerTitle")}</b> {t("ao.bannerBody")}
        </div>
        <PayrollColumnsMenu
          view="ao"
          config={headingConfig}
          fallbackLabel={fallbackLabel}
          canManage={canManage}
        />
      </div>
      <SearchField
        value={search}
        onChange={setSearch}
        placeholder={t("searchPlaceholder")}
        clearLabel={t("clearSearch")}
      />
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
              onRemove={(columnId) => setFilter(columnId, null)}
              clearLabel={t("clearColumnFilters")}
            />
          </div>
        ) : null}
        <div
          tabIndex={editable ? 0 : undefined}
          onKeyDown={onKeyDown}
          className={cn(
            "max-h-[min(560px,62dvh)] overflow-auto outline-none",
            editable && "focus-visible:ring-2 focus-visible:ring-primary/40",
          )}
        >
          <table className="w-max min-w-full border-collapse text-[12px]">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border">
                {columns.map((column, index) => {
                  const sticky = stickyIdentityStyle(
                    column.id,
                    columns.slice(0, index).reduce((sum, col) => sum + stickyIdentityOffset(col.id), 0),
                  );
                  return (
                  <th
                    key={column.id}
                    rowSpan={2}
                    className={cn(TABLE_HEAD_CLASS, "px-2 py-2 text-start align-bottom", sticky?.className)}
                    style={sticky?.style}
                  >
                    <PayrollColumnHeader
                      label={resolveColumnLabel(column.id, t(`riderCols.${column.labelKey}`), headingConfig)}
                      heading={
                        <PayrollHeadingLabel
                          columnKey={column.id}
                          fallback={t(`riderCols.${column.labelKey}`)}
                          config={headingConfig}
                          canManage={canManage}
                        />
                      }
                      columnId={column.id}
                      values={searched.map((row) => String(riderColumnValue(row, column.id) ?? ""))}
                      filter={filters[column.id]}
                      onChange={(next) => setFilter(column.id, next)}
                      sort={sort}
                      onSort={setSort}
                      numeric={column.numeric}
                      className="border-0 p-0"
                    />
                  </th>
                  );
                })}
                {dates.map((date) => (
                  <th
                    key={date}
                    colSpan={2}
                    className={cn(TABLE_HEAD_CLASS, "border-s border-border px-2 py-1.5 text-center text-[11px]")}
                  >
                    {isoDayLabel(date)}
                  </th>
                ))}
              </tr>
              <tr className="border-b border-border">
                {dates.map((date, i) => (
                  <Fragment key={date}>
                    <th className={cn(TABLE_HEAD_CLASS, "border-s border-border px-1 py-1")}>
                      <PayrollColumnHeader
                        label={t("ao.payrollShort")}
                        columnId={dayColumnId(i)}
                        values={dayValues.get(dayColumnId(i)) ?? []}
                        filter={filters[dayColumnId(i)]}
                        onChange={(next) => setFilter(dayColumnId(i), next)}
                        sort={sort}
                        onSort={setSort}
                        numeric={false}
                        className="border-0 p-0"
                      />
                    </th>
                    <th className={cn(TABLE_HEAD_CLASS, "px-1 py-1")}>
                      <PayrollColumnHeader
                        label={t("ao.ordersShort")}
                        columnId={dayOrdersColumnId(i)}
                        values={dayValues.get(dayOrdersColumnId(i)) ?? []}
                        filter={filters[dayOrdersColumnId(i)]}
                        onChange={(next) => setFilter(dayOrdersColumnId(i), next)}
                        sort={sort}
                        onSort={setSort}
                        numeric
                        className="border-0 p-0"
                      />
                    </th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="px-3 py-8 text-center text-xs text-muted-foreground">
                    {t("emptyRiders")}
                  </td>
                </tr>
              ) : (
                visibleRows.map((row, rowIndex) => (
                  <tr key={row.driverId} className="border-b border-border/60 hover:bg-muted/30">
                    {columns.map((column, index) => {
                      const sticky = stickyIdentityStyle(
                        column.id,
                        columns.slice(0, index).reduce((sum, col) => sum + stickyIdentityOffset(col.id), 0),
                      );
                      return (
                      <td
                        key={column.id}
                        className={cn("whitespace-nowrap px-2 py-1.5", sticky?.className, column.id === "name" && "font-medium")}
                        style={sticky?.style}
                      >
                        {column.id === "zoneCategory" ? (
                          <ZoneCategoryPill category={row.zoneCategory} />
                        ) : column.id === "actualHours" ? (
                          row.actualHours.toFixed(2)
                        ) : (
                          String(riderColumnValue(row, column.id) ?? "—")
                        )}
                      </td>
                      );
                    })}
                    {dates.map((date, i) => {
                      const status = row.days[i] ?? "blank";
                      const info = row.dayInfo[i];
                      const adjusted = Boolean(info?.adjusted);
                      const orders = info?.orders ?? 0;
                      const selected = isSelected(rowIndex, i);
                      return (
                        <Fragment key={`${row.driverId}-${date}`}>
                          <td
                            className={cn(
                              "relative border-s border-border/60 px-1 py-1 text-center select-none",
                              selected && "ring-2 ring-inset ring-primary/60",
                              isFillTarget(rowIndex, i) && "outline-dashed outline-1 outline-emerald-500",
                            )}
                            onContextMenu={
                              editable
                                ? (event) => {
                                    event.preventDefault();
                                    session.rememberAnchor(event.currentTarget);
                                    setMenu({ x: event.clientX, y: event.clientY, driverId: row.driverId, date });
                                  }
                                : undefined
                            }
                            onMouseDown={
                              editable
                                ? (event) => {
                                    if (event.button !== 0) return;
                                    event.preventDefault();
                                    session.rememberAnchor(event.currentTarget);
                                    const next = { r0: rowIndex, c0: i, r1: rowIndex, c1: i };
                                    drag.current = { mode: "select", ...next };
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
                                        ? { ...current, r1: rowIndex, c1: i }
                                        : { r0: active.r0, c0: active.c0, r1: rowIndex, c1: i },
                                    );
                                    if (active.mode === "fill") {
                                      setFillPreview({
                                        r0: Math.min(active.r0, rowIndex),
                                        c0: Math.min(active.c0, i),
                                        r1: Math.max(active.r1, rowIndex),
                                        c1: Math.max(active.c1, i),
                                      });
                                    }
                                  }
                                : undefined
                            }
                          >
                            <span
                              className={cn(
                                "relative inline-flex min-w-8 justify-center rounded px-1.5 py-0.5 text-[10px] font-semibold",
                                dayClass(status),
                                adjusted && "outline outline-2 outline-orange-400",
                              )}
                            >
                              {cellParticular(row, i) || "—"}
                              {adjusted ? (
                                <span className="absolute end-0 top-0 size-0 border-e-[6px] border-t-[6px] border-e-transparent border-t-orange-500" />
                              ) : null}
                            </span>
                            {editable && selected && bounds?.bottom === rowIndex && bounds?.right === i ? (
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
                                  };
                                }}
                              />
                            ) : null}
                          </td>
                          <td className="px-1 py-1 text-center tabular-nums">
                            {orders === 0 ? <span className="text-muted-foreground/50">–</span> : orders}
                          </td>
                        </Fragment>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Info className="size-3.5" />
            {t("ao.footNote")}
          </span>
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-semibold text-muted-foreground">
              {t("tableFootRange", {
                shown: visibleRows.length,
                total: riders.length,
                range: month.label,
              })}
            </span>
            {canExport ? (
              <button
                type="button"
                onClick={() =>
                  exportPayrollAttendanceOrdersCsv(month.key, month.dates, visibleRows, {
                    labels: exportLabelsFromConfig(headingConfig, fallbackLabel),
                    hidden: hiddenSetFor("ao", headingConfig),
                  })
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] font-semibold transition-colors hover:bg-muted/50"
              >
                <Download className="size-3.5" />
                {t("downloadTable")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <PayrollLegend riders={riders} />
      <AdjustmentDialog
        state={session.adjust}
        pending={session.pending}
        onCancel={session.cancel}
        onConfirm={session.confirm}
      />
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
          openFor(
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
          openFor(
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
