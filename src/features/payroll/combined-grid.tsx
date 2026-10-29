"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { TABLE_HEAD_CLASS } from "@/components/app";
import { cn } from "@/lib/utils";
import { dayClass, ZoneCategoryPill } from "./payroll-grid";
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
import { PayrollHeadingLabel, stickyIdentityOffset, stickyIdentityStyle } from "./payroll-heading";
import { PayrollAssignCell } from "./payroll-identity-cell";
import { PayrollStatusCell } from "./payroll-status-cell";
import { usePayrollStatusFilterList } from "./payroll-status-context";
import { isoDayLabel } from "./payroll-formulas";
import {
  COMBINED_DAYS_COLUMN_ID,
  COMBINED_IDENTITY_TRIPLE,
  COMBINED_NUMERIC_IDS,
  combinedColumn,
  combinedColumnListLabel,
  combinedDayCellText,
  combinedFilterText,
  combinedRowValues,
  dayValueColumnId,
  formatCombinedValue,
  type CombinedValueContext,
} from "./combined-columns";
import { resolveColumnLabel, type PayrollColumnConfigRow } from "./payroll-column-config";
import type { PayrollRiderRow } from "./payroll-types";

/**
 * The one Combined Payroll table (SOP items 6, 9, 10, 11).
 *
 * MG ID · Driver ID · Name are pinned on the start edge, the day block sits where
 * the operator put it (straight after Status by default), and every other column
 * follows the Columns menu. A header carries the sort pair and the funnel as two
 * separate targets, because sorting and filtering compose.
 */
export function CombinedPayrollGrid({
  dates,
  rows,
  today,
  empty,
  footer,
  exportLabel,
  onExport,
  visibleIds,
  headingConfig,
  headingManage = false,
  identityEdit = false,
  filters: controlledFilters,
  onFiltersChange,
  sort: controlledSort,
  onSortChange,
}: {
  dates: readonly string[];
  rows: readonly PayrollRiderRow[];
  /** Kuwait date the page calls today; days after it print an en dash. */
  today: string;
  empty: string;
  footer: string;
  exportLabel?: string;
  onExport?: (rows: readonly PayrollRiderRow[]) => void;
  /** Ordered, visible column ids. `days` stands for the whole day block. */
  visibleIds: readonly string[];
  headingConfig?: ReadonlyMap<string, PayrollColumnConfigRow>;
  headingManage?: boolean;
  /** Restaurant and Zone dropdowns. Day cells stay read-only on Combined. */
  identityEdit?: boolean;
  /**
   * Filter and sort are controlled, so every group paints the same rows and the
   * page-header export can apply exactly what is on screen.
   */
  filters?: ColumnFilters;
  onFiltersChange?: (next: ColumnFilters) => void;
  sort?: ColumnSort;
  onSortChange?: (next: ColumnSort) => void;
}) {
  const t = useTranslations("pages.payroll");
  const parentRef = useRef<HTMLDivElement>(null);
  const statusList = usePayrollStatusFilterList();
  const [ownFilters, setOwnFilters] = useState<ColumnFilters>({});
  const [ownSort, setOwnSort] = useState<ColumnSort>(null);
  const filters = controlledFilters ?? ownFilters;
  const sort = controlledSort === undefined ? ownSort : controlledSort;
  const setSort = onSortChange ?? setOwnSort;

  const updateFilters = useCallback(
    (updater: (prev: ColumnFilters) => ColumnFilters) => {
      if (onFiltersChange) onFiltersChange(updater(filters));
      else setOwnFilters(updater);
    },
    [filters, onFiltersChange],
  );

  const ctx = useMemo<CombinedValueContext>(() => ({ dates, today }), [dates, today]);

  const valuesByRow = useMemo(() => {
    const map = new Map<string, Record<string, string | number | null>>();
    for (const row of rows) map.set(row.driverId, combinedRowValues(row, ctx));
    return map;
  }, [rows, ctx]);

  const visibleRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      const values = valuesByRow.get(row.driverId);
      if (!values) return true;
      return rowMatchesColumnFilters(values, filters, COMBINED_NUMERIC_IDS, combinedFilterText);
    });
    return sortByColumn(
      filtered,
      sort,
      (row, columnId) => valuesByRow.get(row.driverId)?.[columnId] ?? null,
    );
  }, [rows, filters, sort, valuesByRow]);

  const columns = useMemo(
    () => visibleIds.filter((id) => id === COMBINED_DAYS_COLUMN_ID || combinedColumn(id)),
    [visibleIds],
  );
  const colCount =
    COMBINED_IDENTITY_TRIPLE.length +
    columns.reduce((sum, id) => sum + (id === COMBINED_DAYS_COLUMN_ID ? dates.length : 1), 0);

  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 16,
  });

  const identityOffset = (index: number) =>
    COMBINED_IDENTITY_TRIPLE.slice(0, index).reduce((sum, id) => sum + stickyIdentityOffset(id), 0);

  function identityLabel(columnId: string): string {
    const fallback = t(`riderCols.${columnId}`);
    return headingConfig ? resolveColumnLabel(columnId, fallback, headingConfig) : fallback;
  }

  function columnLabel(columnId: string, labelKey: string): string {
    const fallback = t(`combinedCols.${labelKey}`);
    return headingConfig ? resolveColumnLabel(columnId, fallback, headingConfig) : fallback;
  }

  function labelOf(columnId: string): string {
    if (
      COMBINED_IDENTITY_TRIPLE.includes(columnId as (typeof COMBINED_IDENTITY_TRIPLE)[number])
    ) {
      return identityLabel(columnId);
    }
    if (/^d\d+$/.test(columnId)) {
      const index = Number(columnId.slice(1)) - 1;
      return dates[index] ? isoDayLabel(dates[index]) : columnId;
    }
    const column = combinedColumn(columnId);
    return column ? columnLabel(column.id, column.labelKey) : columnId;
  }

  const filterChips = activeFilterChips(filters, labelOf);
  const hasFilters = filterChips.length > 0 || Boolean(sort);

  function renderHeader(id: string) {
    if (id === COMBINED_DAYS_COLUMN_ID) {
      return dates.map((date, index) => {
        const columnId = dayValueColumnId(index);
        return (
          <PayrollColumnHeader
            key={`${columnId}-${date}`}
            label={isoDayLabel(date)}
            columnId={columnId}
            values={rows.map((row) => String(valuesByRow.get(row.driverId)?.[columnId] ?? ""))}
            filter={filters[columnId]}
            onChange={(next) => setFiltersFor(updateFilters, columnId, next)}
            sort={sort}
            onSort={setSort}
            sortPair
            className={cn(TABLE_HEAD_CLASS, "min-w-[52px] px-1 py-2 text-center")}
          />
        );
      });
    }
    const column = combinedColumn(id);
    if (!column) return null;
    return (
      <PayrollColumnHeader
        key={id}
        label={columnLabel(column.id, column.labelKey)}
        heading={
          headingConfig ? (
            <PayrollHeadingLabel
              columnKey={column.id}
              fallback={t(`combinedCols.${column.labelKey}`)}
              config={headingConfig}
              canManage={headingManage}
            />
          ) : undefined
        }
        columnId={id}
        values={rows.map((row) => String(valuesByRow.get(row.driverId)?.[id] ?? ""))}
        fixedList={id === "status" ? statusList : undefined}
        filter={filters[id]}
        onChange={(next) => setFiltersFor(updateFilters, id, next)}
        sort={sort}
        onSort={setSort}
        numeric={column.numeric}
        listLabel={combinedColumnListLabel(id)}
        sortPair
        className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}
      />
    );
  }

  function renderBodyCell(row: PayrollRiderRow, id: string) {
    if (id === COMBINED_DAYS_COLUMN_ID) {
      return dates.map((date, dayIndex) => (
        <DayCell key={`${row.driverId}-${date}`} row={row} dayIndex={dayIndex} ctx={ctx} />
      ));
    }
    const column = combinedColumn(id);
    if (!column) return null;
    return (
      <td key={id} className="whitespace-nowrap px-2 py-1.5">
        {summaryCell(row, column.id, ctx, identityEdit)}
      </td>
    );
  }


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
              updateFilters(() => ({}));
              setSort(null);
            }}
            onRemove={(columnId) =>
              updateFilters((prev) => {
                const next = { ...prev };
                delete next[columnId];
                return next;
              })
            }
            clearLabel={t("clearColumnFilters")}
          />
        </div>
      ) : null}
      <div ref={parentRef} className="max-h-[min(560px,56dvh)] overflow-auto">
        <table className="w-max min-w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              {COMBINED_IDENTITY_TRIPLE.map((columnId, index) => {
                const sticky = stickyIdentityStyle(columnId, identityOffset(index), "head");
                return (
                  <PayrollColumnHeader
                    key={columnId}
                    label={identityLabel(columnId)}
                    // SOP §4/§7: MG ID, Driver ID and Name carry no pencil at all.
                    columnId={columnId}
                    values={rows.map((row) => String(valuesByRow.get(row.driverId)?.[columnId] ?? ""))}
                    filter={filters[columnId]}
                    onChange={(next) => setFiltersFor(updateFilters, columnId, next)}
                    sort={sort}
                    onSort={setSort}
                    sortPair
                    className={cn(TABLE_HEAD_CLASS, "px-2 py-2", sticky?.className)}
                    style={sticky?.style}
                  />
                );
              })}
              {columns.map((id) => renderHeader(id))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td
                  colSpan={colCount}
                  className="px-3 py-8 text-center text-xs text-muted-foreground"
                >
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
                      {COMBINED_IDENTITY_TRIPLE.map((columnId, index) => {
                        const sticky = stickyIdentityStyle(columnId, identityOffset(index));
                        return (
                          <td
                            key={columnId}
                            className={cn(
                              "whitespace-nowrap px-2 py-1.5",
                              sticky?.className,
                              columnId === "name" && "font-medium",
                            )}
                            style={sticky?.style}
                          >
                            {identityCell(row, columnId)}
                          </td>
                        );
                      })}
                      {columns.map((id) => renderBodyCell(row, id))}
                    </tr>
                  );
                })}
                {virtualizer.getVirtualItems().length > 0 ? (
                  <tr
                    aria-hidden
                    style={{
                      height: Math.max(
                        0,
                        virtualizer.getTotalSize() -
                          (virtualizer.getVirtualItems().at(-1)?.end ?? 0),
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
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
        <span>{footer}</span>
        {onExport && exportLabel ? (
          <button
            type="button"
            onClick={() => onExport(visibleRows)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted/50"
          >
            <Download className="size-3.5" />
            {exportLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}


function spacerCells(count: number) {
  return Array.from({ length: count }, (_, index) => <td key={index} className="p-0" />);
}

function setFiltersFor(
  update: (updater: (prev: ColumnFilters) => ColumnFilters) => void,
  columnId: string,
  next: ColumnFilters[string] | null,
) {
  update((prev) => {
    const copy = { ...prev };
    if (!next || !columnFilterActive(next)) delete copy[columnId];
    else copy[columnId] = next;
    return copy;
  });
}

/** MG ID, Driver ID and Name are master data: read-only here (SOP items 7, 11). */
function identityCell(row: PayrollRiderRow, columnId: string): string {
  const raw = columnId === "amId" ? row.amId : columnId === "mgId" ? row.mgId : row.name;
  return raw && raw !== "—" ? raw : "—";
}

/** One summary cell. Restaurant and Zone are catalog dropdowns; the rest print. */
function summaryCell(
  row: PayrollRiderRow,
  columnId: string,
  ctx: CombinedValueContext,
  canEdit: boolean,
) {
  if (columnId === "rest") {
    return <PayrollAssignCell row={row} field="restaurantName" canEdit={canEdit} />;
  }
  if (columnId === "zone") return <PayrollAssignCell row={row} field="zoneId" canEdit={canEdit} />;
  if (columnId === "zcat") return <ZoneCategoryPill category={row.zoneCategory} />;
  if (columnId === "status") {
    return <PayrollStatusCell row={row} today={ctx.today ?? undefined} canEdit={false} />;
  }
  const column = combinedColumn(columnId);
  if (!column) return null;
  const value = column.value(row, ctx);
  if (columnId === "eff") {
    const numeric = typeof value === "number" ? value : Number.NaN;
    return (
      <span
        className={cn(
          "font-semibold tabular-nums",
          Number.isFinite(numeric) && numeric >= 100 && "text-emerald-700",
          Number.isFinite(numeric) && numeric < 70 && "text-red-600",
        )}
      >
        {formatCombinedValue(columnId, value)}
      </span>
    );
  }
  const text = formatCombinedValue(columnId, value);
  return text === "—" ? <span className="text-muted-foreground/50">—</span> : text;
}

/** A day cell: the printed token on the shared day palette, `–` after today. */
function DayCell({
  row,
  dayIndex,
  ctx,
}: {
  row: PayrollRiderRow;
  dayIndex: number;
  ctx: CombinedValueContext;
}) {
  const t = useTranslations("pages.payroll");
  const status = row.days[dayIndex] ?? "blank";
  const info = row.dayInfo[dayIndex];
  const text = combinedDayCellText(row, dayIndex, ctx);
  const date = ctx.dates[dayIndex];
  const future = Boolean(ctx.today && date && date > ctx.today);
  return (
    <td
      title={t("cellHint", {
        status: text || "—",
        hours: info?.creditedHours ?? 0,
        orders: info?.orders ?? 0,
        logged: info?.loggedHours || (info?.elapsedHours ?? 0),
      })}
      className={cn(
        "relative min-w-[52px] px-1 py-1.5 text-center text-xs font-semibold",
        future ? "text-muted-foreground/50" : dayClass(status, row.jobEndDescription),
        Boolean(info?.adjusted) && "outline outline-2 outline-orange-400",
      )}
    >
      {text}
    </td>
  );
}

