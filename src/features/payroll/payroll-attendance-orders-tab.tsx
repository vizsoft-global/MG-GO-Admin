"use client";

import { Fragment, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Download, Info } from "lucide-react";
import { TABLE_HEAD_CLASS } from "@/components/app";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  dayLabel,
  dayStatusLabel,
  payrollRiderMatchesSearch,
  type DayStatus,
  type PayrollMonthMeta,
} from "./payroll-formulas";
import { formatEfficiencyCell, exportPayrollAttendanceOrdersCsv } from "./payroll-csv";
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
  dayColumnId,
  dayOrdersColumnId,
  RIDER_IDENTITY_COLUMNS,
  RIDER_TOTAL_COLUMNS,
  riderColumnValue,
} from "./payroll-rider-columns";
import { dayClass, ZoneCategoryPill } from "./payroll-grid";
import type { PayrollRiderRow } from "./payroll-types";

/**
 * SOP §5.4 — "Payroll attendance and Orders", read-only.
 *
 * Two sub-columns per day: the credited Payroll day (the engine's verdict, in
 * its own colour) and the reconciled Orders count. They sit together because the
 * question this tab answers is *why* a day was credited — a rider with 12 h and
 * no orders is a different problem from a rider with 3 h and 11 orders, and one
 * number per day cannot tell them apart.
 *
 * Nothing here writes: no selection, no fill handle, no dialog. Adjusting a day
 * happens on Combined, which is the grid that owns the reason requirement.
 */
export function PayrollAttendanceOrdersTab({
  month,
  riders,
  canExport,
}: {
  month: PayrollMonthMeta;
  riders: readonly PayrollRiderRow[];
  canExport: boolean;
}) {
  const t = useTranslations("pages.payroll");
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [sort, setSort] = useState<ColumnSort>(null);

  const columns = useMemo(() => [...RIDER_IDENTITY_COLUMNS, ...RIDER_TOTAL_COLUMNS], []);

  const searched = useMemo(
    () => riders.filter((r) => payrollRiderMatchesSearch(r, search)),
    [riders, search],
  );

  const visibleRows = useMemo(() => {
    const filtered = searched.filter((row) => {
      const values: Record<string, string | number | null> = {};
      for (const column of columns) values[column.id] = riderColumnValue(row, column.id);
      for (let i = 0; i < month.days; i += 1) {
        values[dayColumnId(i)] = riderColumnValue(row, dayColumnId(i));
        values[dayOrdersColumnId(i)] = riderColumnValue(row, dayOrdersColumnId(i));
      }
      return rowMatchesColumnFilters(values, filters);
    });
    return sortByColumn(filtered, sort, (row, columnId) => riderColumnValue(row, columnId));
  }, [searched, filters, sort, columns, month.days]);

  const labelOf = (columnId: string) => {
    const riderColumn = columns.find((c) => c.id === columnId);
    if (riderColumn) return t(`riderCols.${riderColumn.labelKey}`);
    const dayMatch = /^([do])(\d+)$/.exec(columnId);
    if (dayMatch) {
      const day = Number(dayMatch[2]);
      return dayMatch[1] === "o"
        ? t("ao.ordersColumn", { day })
        : t("ao.payrollColumn", { day });
    }
    return columnId;
  };
  const chips = activeFilterChips(filters, labelOf);
  const dayHeaders = Array.from({ length: month.days }, (_, i) => dayLabel(month.key, i + 1, locale));

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
    for (let i = 0; i < month.days; i += 1) {
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
  }, [riders, month.days]);

  const columnCount = columns.length + month.days * 2;

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
        {chips.length ? (
          <div className="border-b border-border px-3 py-2">
            <PayrollFilterChips
              chips={chips}
              onClear={() => {
                setFilters({});
                setSort(null);
              }}
              onRemove={(columnId) => setFilter(columnId, null)}
              clearLabel={t("clearFilters")}
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
                      index === 0 && "sticky start-0 z-20 bg-card",
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
                {dayHeaders.map((label) => (
                  <th
                    key={label}
                    colSpan={2}
                    className={cn(
                      TABLE_HEAD_CLASS,
                      "border-s border-border px-2 py-1.5 text-center text-[11px]",
                    )}
                  >
                    {label}
                  </th>
                ))}
              </tr>
              <tr className="border-b border-border">
                {dayHeaders.map((label, i) => (
                  <Fragment key={label}>
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
                  <td
                    colSpan={columnCount}
                    className="px-3 py-8 text-center text-xs text-muted-foreground"
                  >
                    {t("emptyRiders")}
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => {
                  const eff = formatEfficiencyCell(row.efficiency);
                  const statusKey = row.status === "Active" ? "active" : "inactive";
                  return (
                    <tr key={row.driverId} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="sticky start-0 z-10 whitespace-nowrap bg-card px-2 py-1.5">
                        {row.amId}
                      </td>
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
                      {Array.from({ length: month.days }, (_, i) => {
                        const status = row.days[i] ?? "blank";
                        const info = row.dayInfo[i];
                        const adjusted = Boolean(info?.adjusted);
                        return (
                          <Fragment key={`${row.driverId}-${i}`}>
                            <td className="border-s border-border/60 px-1 py-1 text-center">
                              <span
                                title={[
                                  dayStatusLabel(status),
                                  info?.ruleLabel ? `· ${info.ruleLabel}` : "",
                                  adjusted && info?.adjustmentReason
                                    ? `· ${info.adjustmentReason}`
                                    : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                className={cn(
                                  "inline-flex min-w-8 justify-center rounded px-1.5 py-0.5 text-[10px] font-semibold",
                                  dayClass(status),
                                  adjusted && "ring-1 ring-inset ring-orange-400",
                                )}
                              >
                                {payrollDayToken(status)}
                              </span>
                            </td>
                            <td className="px-1 py-1 text-center tabular-nums">
                              {info ? info.orders : <span className="text-muted-foreground/50">—</span>}
                            </td>
                          </Fragment>
                        );
                      })}
                    </tr>
                  );
                })
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
              {t("tableFoot", {
                shown: visibleRows.length,
                total: riders.length,
                month: month.label,
                days: month.days,
                fixed: month.fixedDays,
              })}
            </span>
            {canExport ? (
              <button
                type="button"
                onClick={() =>
                  exportPayrollAttendanceOrdersCsv(month.key, month.days, visibleRows)
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
    </div>
  );
}

/**
 * The cell token. This is the same short code the CSV writes and the clipboard
 * reads, so the read-only tab, the editable grid and the export describe a day
 * identically — a second vocabulary is how one of them starts disagreeing.
 */
function payrollDayToken(status: DayStatus): string {
  switch (status) {
    case "work":
      return "12";
    case "reduced3":
      return "3h";
    case "half":
      return "6";
    case "actual":
      return "ACT";
    case "off":
      return "OFF";
    case "sick":
      return "SICK";
    case "accident":
      return "ACC";
    case "vehicle":
      return "VEH";
    case "absent":
      return "ABS";
    case "abs_lh":
      return "ALH";
    case "abs_lo":
      return "ALO";
    case "custom":
      return "CUS";
    case "blank":
      return "—";
    default: {
      const never: never = status;
      return never;
    }
  }
}
