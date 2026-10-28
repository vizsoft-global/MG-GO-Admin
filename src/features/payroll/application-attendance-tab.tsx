"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Clock3, Download, Info } from "lucide-react";
import { TABLE_HEAD_CLASS } from "@/components/app";
import { cn } from "@/lib/utils";
import { isoDayLabel, payrollRiderMatchesSearch, type PayrollPeriod } from "./payroll-formulas";
import { exportPayrollApplicationAttendanceCsv } from "./payroll-csv";
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
  APP_ATTENDANCE_LEAD_COLUMNS,
  appAttendanceTotals,
  appDayColumnId,
  appHoursForDay,
  riderColumnValue,
} from "./payroll-rider-columns";
import {
  columnHiddenIn,
  configByKey,
  exportLabelsFromConfig,
  hiddenSetFor,
  resolveColumnLabel,
} from "./payroll-column-config";
import {
  PayrollColumnsMenu,
  PayrollHeadingLabel,
  stickyIdentityOffset,
  stickyIdentityStyle,
} from "./payroll-heading";
import { PayrollListToolbar } from "./payroll-list-toolbar";
import { PayrollStatusCell } from "./payroll-status-cell";
import { usePayrollStatusFilterList } from "./payroll-status-context";
import { payrollAssignField } from "./payroll-assign";
import {
  PayrollAssignCell,
  PayrollIdentityCell,
  payrollIdentityField,
  payrollIdentityValue,
} from "./payroll-identity-cell";
import type { PayrollRiderRow } from "./payroll-types";
import { usePayrollColumnConfig } from "./use-payroll";

function formatHours(value: number): string {
  return value.toFixed(2);
}

export function ApplicationAttendanceTab({
  month,
  riders,
  canExport,
  canManage = false,
  today,
}: {
  month: PayrollPeriod;
  riders: readonly PayrollRiderRow[];
  canExport: boolean;
  canManage?: boolean;
  /** Kuwait date the page calls today; drives the Rider Status column. */
  today: string;
}) {
  const t = useTranslations("pages.payroll");
  const statusList = usePayrollStatusFilterList();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [sort, setSort] = useState<ColumnSort>(null);
  const headings = usePayrollColumnConfig();
  const headingConfig = useMemo(() => configByKey(headings.data), [headings.data]);
  const columns = useMemo(
    () =>
      APP_ATTENDANCE_LEAD_COLUMNS.filter(
        (column) => !columnHiddenIn(column.id, "app_attendance", headingConfig),
      ),
    [headingConfig],
  );
  const dates = month.dates;

  const searched = useMemo(
    () => riders.filter((rider) => payrollRiderMatchesSearch(rider, search)),
    [riders, search],
  );

  const visibleRows = useMemo(() => {
    const filtered = searched.filter((row) => {
      const values: Record<string, string | number | null> = {};
      for (const column of APP_ATTENDANCE_LEAD_COLUMNS) {
        values[column.id] = riderColumnValue(row, column.id, today);
      }
      for (let i = 0; i < dates.length; i += 1) {
        values[appDayColumnId(i)] = riderColumnValue(row, appDayColumnId(i));
      }
      return rowMatchesColumnFilters(values, filters);
    });
    return sortByColumn(filtered, sort, (row, columnId) => riderColumnValue(row, columnId, today));
  }, [searched, filters, sort, dates.length, today]);

  const fallbackLabel = useCallback((key: string) => t(`riderCols.${key}`), [t]);

  const labelOf = (columnId: string) => {
    const lead = APP_ATTENDANCE_LEAD_COLUMNS.find((column) => column.id === columnId);
    if (lead) {
      return resolveColumnLabel(columnId, t(`riderCols.${lead.labelKey}`), headingConfig);
    }
    const dayMatch = /^a(\d+)$/.exec(columnId);
    if (dayMatch) {
      const date = dates[Number(dayMatch[1]) - 1];
      return date ? isoDayLabel(date) : columnId;
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
      const id = appDayColumnId(i);
      const seen = new Set<string>();
      for (const row of riders) {
        const value = riderColumnValue(row, id);
        if (value !== null) seen.add(String(value));
      }
      map.set(id, [...seen]);
    }
    return map;
  }, [riders, dates.length]);

  const totals = useMemo(() => {
    let hours = 0;
    let activeDays = 0;
    let activeRiders = 0;
    const perDay = dates.map(() => 0);
    for (const row of visibleRows) {
      const sum = appAttendanceTotals(row);
      hours += sum.totalHours;
      activeDays += sum.activeDays;
      if (sum.activeDays > 0) activeRiders += 1;
      for (let i = 0; i < dates.length; i += 1) perDay[i] += appHoursForDay(row, i);
    }
    return {
      hours,
      activeDays,
      activeRiders,
      avg: activeDays > 0 ? hours / activeDays : 0,
      perDay,
    };
  }, [visibleRows, dates]);

  const columnCount = columns.length + dates.length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-xs leading-5 shadow-sm">
          <b>{t("appAttendance.bannerTitle")}</b> {t("appAttendance.bannerBody")}
        </div>
        <PayrollColumnsMenu
          view="app_attendance"
          config={headingConfig}
          fallbackLabel={fallbackLabel}
          canManage={canManage}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Clock3 className="size-3" />
            {t("riderCols.appTotalHours")}
          </div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums">
            {formatHours(totals.hours)} <span className="text-xs font-normal">h</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {t("appAttendance.activeRiders", { count: totals.activeRiders })}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("riderCols.appActiveDays")}
          </div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums">{totals.activeDays}</div>
          <div className="text-xs text-muted-foreground">{t("appAttendance.daysHint")}</div>
        </div>
        <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("riderCols.appAvgHours")}
          </div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums">
            {formatHours(totals.avg)} <span className="text-xs font-normal">h</span>
          </div>
          <div className="text-xs text-muted-foreground">{t("appAttendance.avgHint")}</div>
        </div>
      </div>

      <PayrollListToolbar
        prefKey="payroll-app-attendance"
        search={search}
        onSearchChange={setSearch}
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
          <table className="w-max min-w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border">
                {columns.map((column, index) => {
                  const sticky = stickyIdentityStyle(
                    column.id,
                    columns
                      .slice(0, index)
                      .reduce((sum, col) => sum + stickyIdentityOffset(col.id), 0),
                    "head",
                  );
                  return (
                    <th
                      key={column.id}
                      className={cn(TABLE_HEAD_CLASS, "px-2 py-2 text-start", sticky?.className)}
                      style={sticky?.style}
                    >
                      <PayrollColumnHeader
                        label={resolveColumnLabel(
                          column.id,
                          t(`riderCols.${column.labelKey}`),
                          headingConfig,
                        )}
                        heading={
                          <PayrollHeadingLabel
                            columnKey={column.id}
                            fallback={t(`riderCols.${column.labelKey}`)}
                            config={headingConfig}
                            canManage={canManage}
                          />
                        }
                        columnId={column.id}
                        values={searched.map((row) =>
                          String(riderColumnValue(row, column.id, today) ?? ""),
                        )}
                        fixedList={column.id === "status" ? statusList : undefined}
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
                {dates.map((date, i) => (
                  <th
                    key={appDayColumnId(i)}
                    className={cn(
                      TABLE_HEAD_CLASS,
                      "border-s border-border px-1 py-2 text-center text-xs",
                    )}
                  >
                    <PayrollColumnHeader
                      label={isoDayLabel(date)}
                      columnId={appDayColumnId(i)}
                      values={dayValues.get(appDayColumnId(i)) ?? []}
                      filter={filters[appDayColumnId(i)]}
                      onChange={(next) => setFilter(appDayColumnId(i), next)}
                      sort={sort}
                      onSort={setSort}
                      numeric
                      className="border-0 p-0"
                    />
                  </th>
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
                visibleRows.map((row) => (
                  <tr key={row.driverId} className="border-b border-border/60 hover:bg-muted/30">
                    {columns.map((column, index) => {
                      const sticky = stickyIdentityStyle(
                        column.id,
                        columns
                          .slice(0, index)
                          .reduce((sum, col) => sum + stickyIdentityOffset(col.id), 0),
                      );
                      const value = riderColumnValue(row, column.id, today);
                      const identityField = payrollIdentityField(column.id);
                      const assignField = payrollAssignField(column.id);
                      const display =
                        column.id === "status" ? (
                          <PayrollStatusCell row={row} today={today} canEdit={false} />
                        ) : assignField ? (
                          <PayrollAssignCell row={row} field={assignField} canEdit={canManage} />
                        ) : identityField ? (
                          <PayrollIdentityCell
                            driverId={row.driverId}
                            field={identityField}
                            value={payrollIdentityValue(row, identityField)}
                            canEdit={canManage}
                          />
                        ) : column.id === "appTotalHours"
                          ? formatHours(appAttendanceTotals(row).totalHours)
                          : column.id === "appAvgHours"
                            ? formatHours(appAttendanceTotals(row).avgHours)
                            : value === null || value === ""
                              ? "—"
                              : String(value);
                      return (
                        <td
                          key={column.id}
                          className={cn(
                            "whitespace-nowrap px-2 py-1.5",
                            column.numeric && "tabular-nums",
                            column.id === "name" && "font-medium",
                            sticky?.className,
                          )}
                          style={sticky?.style}
                        >
                          {display}
                        </td>
                      );
                    })}
                    {dates.map((date, i) => {
                      const hours = appHoursForDay(row, i);
                      return (
                        <td
                          key={`${row.driverId}-${date}`}
                          className={cn(
                            "border-s border-border/60 px-1 py-1.5 text-center tabular-nums",
                            hours <= 0 && "text-muted-foreground/40",
                          )}
                        >
                          {hours > 0 ? formatHours(hours) : "–"}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
            <tfoot className="sticky bottom-0 bg-muted/40">
              <tr className="border-t border-border text-xs font-semibold">
                <td colSpan={Math.max(columns.length, 1)} className="px-2 py-1.5">
                  {t("appAttendance.totalsRow")}
                </td>
                {dates.map((date, i) => (
                  <td
                    key={`total-${date}`}
                    className="border-s border-border/60 px-1 py-1.5 text-center tabular-nums"
                  >
                    {totals.perDay[i] > 0 ? formatHours(totals.perDay[i]) : "–"}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="size-3.5" />
            {t("appAttendance.footNote")}
          </span>
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-muted-foreground">
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
                  exportPayrollApplicationAttendanceCsv(month.key, month.dates, visibleRows, {
                    labels: exportLabelsFromConfig(headingConfig, fallbackLabel),
                    hidden: hiddenSetFor("app_attendance", headingConfig),
                    today,
                  })
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-semibold transition-colors hover:bg-muted/50"
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
