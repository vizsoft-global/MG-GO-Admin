"use client";

import { Fragment, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Info } from "lucide-react";
import { TABLE_HEAD_CLASS } from "@/components/app";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  dayGridLabel,
  isoDayLabel,
  payrollRiderMatchesSearch,
  type PayrollPeriod,
} from "./payroll-formulas";
import { exportPayrollAttendanceOrdersCsv } from "./payroll-csv";
import {
  activeFilterChips,
  PayrollColumnHeader,
  PayrollFilterChips,
  rowMatchesColumnFilters,
  sortByColumn,
  type ColumnFilters,
  type ColumnSort,
} from "./payroll-column-filter";
import {
  AO_LEAD_COLUMNS,
  dayColumnId,
  dayOrdersColumnId,
  riderColumnValue,
} from "./payroll-rider-columns";
import { dayClass, PayrollLegend, ZoneCategoryPill } from "./payroll-grid";
import type { PayrollRiderRow } from "./payroll-types";

export function PayrollAttendanceOrdersTab({
  month,
  riders,
  canExport,
}: {
  month: PayrollPeriod;
  riders: readonly PayrollRiderRow[];
  canExport: boolean;
}) {
  const t = useTranslations("pages.payroll");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [sort, setSort] = useState<ColumnSort>(null);
  const columns = AO_LEAD_COLUMNS;
  const dates = month.dates;

  const searched = useMemo(
    () => riders.filter((r) => payrollRiderMatchesSearch(r, search)),
    [riders, search],
  );

  const visibleRows = useMemo(() => {
    const filtered = searched.filter((row) => {
      const values: Record<string, string | number | null> = {};
      for (const column of columns) values[column.id] = riderColumnValue(row, column.id);
      for (let i = 0; i < dates.length; i += 1) {
        values[dayColumnId(i)] = riderColumnValue(row, dayColumnId(i));
        values[dayOrdersColumnId(i)] = riderColumnValue(row, dayOrdersColumnId(i));
      }
      return rowMatchesColumnFilters(values, filters);
    });
    return sortByColumn(filtered, sort, (row, columnId) => riderColumnValue(row, columnId));
  }, [searched, filters, sort, columns, dates.length]);

  const labelOf = (columnId: string) => {
    const riderColumn = columns.find((c) => c.id === columnId);
    if (riderColumn) return t(`riderCols.${riderColumn.labelKey}`);
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
      if (!next) delete copy[columnId];
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

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-[12px] leading-5 shadow-sm">
        <b>{t("ao.bannerTitle")}</b> {t("ao.bannerBody")}
      </div>
      <Input
        className="h-9"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("searchPlaceholder")}
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
        <div className="max-h-[min(560px,62dvh)] overflow-auto">
          <table className="w-max min-w-full border-collapse text-[12px]">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border">
                {columns.map((column, index) => (
                  <th
                    key={column.id}
                    rowSpan={2}
                    className={cn(
                      TABLE_HEAD_CLASS,
                      "px-2 py-2 text-start align-bottom",
                      index === 0 && "sticky start-0 z-20 min-w-16 bg-card",
                      index === 1 && "sticky start-16 z-20 min-w-16 bg-card",
                      index === 2 && "sticky start-32 z-20 min-w-[190px] bg-card",
                    )}
                  >
                    <PayrollColumnHeader
                      label={t(`riderCols.${column.labelKey}`)}
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
                ))}
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
                visibleRows.map((row) => (
                  <tr key={row.driverId} className="border-b border-border/60 hover:bg-muted/30">
                    {columns.map((column, index) => (
                      <td
                        key={column.id}
                        className={cn(
                          "whitespace-nowrap px-2 py-1.5",
                          index === 0 && "sticky start-0 z-10 bg-card",
                          index === 1 && "sticky start-16 z-10 bg-card",
                          index === 2 && "sticky start-32 z-10 bg-card font-medium",
                        )}
                      >
                        {column.id === "zoneCategory" ? (
                          <ZoneCategoryPill category={row.zoneCategory} />
                        ) : column.id === "actualHours" ? (
                          row.actualHours.toFixed(2)
                        ) : (
                          String(riderColumnValue(row, column.id) ?? "—")
                        )}
                      </td>
                    ))}
                    {dates.map((date, i) => {
                      const status = row.days[i] ?? "blank";
                      const info = row.dayInfo[i];
                      const adjusted = Boolean(info?.adjusted);
                      const orders = info?.orders ?? 0;
                      return (
                        <Fragment key={`${row.driverId}-${date}`}>
                          <td className="border-s border-border/60 px-1 py-1 text-center">
                            <span
                              className={cn(
                                "relative inline-flex min-w-8 justify-center rounded px-1.5 py-0.5 text-[10px] font-semibold",
                                dayClass(status),
                                adjusted && "outline outline-2 outline-orange-400",
                              )}
                            >
                              {status === "blank" ? "—" : dayGridLabel(status, info?.creditedHours ?? 0)}
                              {adjusted ? (
                                <span className="absolute end-0 top-0 size-0 border-e-[6px] border-t-[6px] border-e-transparent border-t-orange-500" />
                              ) : null}
                            </span>
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
                onClick={() => exportPayrollAttendanceOrdersCsv(month.key, month.dates, visibleRows)}
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
    </div>
  );
}
