"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Building2, Percent, Store, UserCheck, Users } from "lucide-react";
import { TABLE_HEAD_CLASS } from "@/components/app";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { GroupedSections, groupRows } from "@/components/app/app-list-controls";
import {
  EmptyCell,
  TableNameCell,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import {
  groupBanner,
  groupRows as groupTableRows,
  ListToolbar,
  rowMatches,
  visibleColumnIds,
} from "@/features/roster/table-kit";
import { formatPct } from "@/lib/format/percent";
import {
  computeCombinedKpis,
  isoDayLabel,
  payrollRiderMatchesSearch,
  type PayrollPeriod,
} from "./payroll-formulas";
import { PayrollListToolbar, usePayrollListPrefs } from "./payroll-list-toolbar";
import { PayrollLegend } from "./payroll-grid";
import {
  COMBINED_DAYS_COLUMN_ID,
  COMBINED_NUMERIC_IDS,
  combinedColumn,
  combinedRowValues,
} from "./combined-columns";
import { CombinedColumnsMenu } from "./combined-columns-menu";
import { CombinedPayrollGrid } from "./combined-grid";
import { useCombinedColumns } from "./use-combined-columns";
import { useCombinedExportBridge } from "./combined-export-bridge";
import { exportCombinedPayrollXlsx } from "./combined-xlsx";
import type { CombinedXlsxColumn } from "./combined-xlsx";
import {
  rowMatchesColumnFilters,
  sortByColumn,
  type ColumnFilters,
  type ColumnSort,
} from "./payroll-column-filter";
import { configByKey, resolveColumnLabel } from "./payroll-column-config";
import { usePayrollAdjustmentAudit, usePayrollColumnConfig } from "./use-payroll";
import type { PayrollRiderRow } from "./payroll-types";

const ZONE_CATEGORY_KEYS = ["good", "average", "low", "not_set"] as const;


/**
 * Combined Payroll (SOP v1.0 items 1–14).
 *
 * One table: pinned MG ID · Driver ID · Name, the day block where the Columns
 * menu puts it, then the ordered summary columns. Required Hours and Efficiency
 * are this tab's own formula (counted days × the project's day length), and the
 * Excel export is the screen — same columns, same fills, real numbers.
 */
export function CombinedPayrollTab({
  month,
  riders,
  canExport,
  canManage,
  today,
}: {
  month: PayrollPeriod;
  riders: readonly PayrollRiderRow[];
  canExport: boolean;
  canManage: boolean;
  /** Kuwait date the page calls today; drives the Status column and future days. */
  today: string;
}) {
  const t = useTranslations("pages.payroll");
  const [search, setSearch] = useState("");
  const { prefs } = usePayrollListPrefs("payroll-combined");
  const audit = usePayrollAdjustmentAudit({ from: month.from, to: month.to });
  const headings = usePayrollColumnConfig();
  const headingConfig = useMemo(() => configByKey(headings.data), [headings.data]);
  const columns = useCombinedColumns();
  const bridge = useCombinedExportBridge();
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [sort, setSort] = useState<ColumnSort>(null);

  const searched = useMemo(
    () => riders.filter((r) => payrollRiderMatchesSearch(r, search)),
    [riders, search],
  );

  const valueContext = useMemo(() => ({ dates: month.dates, today }), [month.dates, today]);

  const visibleRows = useMemo(() => {
    const filtered = searched.filter((row) =>
      rowMatchesColumnFilters(combinedRowValues(row, valueContext), filters, COMBINED_NUMERIC_IDS),
    );
    return sortByColumn(
      filtered,
      sort,
      (row, columnId) => combinedRowValues(row, valueContext)[columnId] ?? null,
    );
  }, [searched, filters, sort, valueContext]);

  // SOP §8: the cards follow the **top filters and the status chips** only.
  // Search and the per-column funnels change the table and the export, never the
  // cards, so these read `riders` (already filtered by the shell) and not
  // `visibleRows`.
  const kpis = useMemo(
    () =>
      computeCombinedKpis(
        riders.map((row) => ({
          status: row.status,
          projectKey: row.projectKey,
          partner: row.partner,
          efficiency: Number(combinedColumn("eff")?.value(row, valueContext) ?? 0),
        })),
      ),
    [riders, valueContext],
  );

  const identityHeader = useCallback(
    (columnId: "amId" | "mgId" | "name") => {
      const fallback = t(`riderCols.${columnId}`);
      return headingConfig ? resolveColumnLabel(columnId, fallback, headingConfig) : fallback;
    },
    [headingConfig, t],
  );

  const columnLabel = useCallback(
    (columnId: string, labelKey: string) => {
      const fallback = t(`combinedCols.${labelKey}`);
      return headingConfig ? resolveColumnLabel(columnId, fallback, headingConfig) : fallback;
    },
    [headingConfig, t],
  );

  const exportColumns = useMemo<CombinedXlsxColumn[]>(() => {
    const out: CombinedXlsxColumn[] = [];
    for (const id of columns.visibleIds) {
      if (id === COMBINED_DAYS_COLUMN_ID) {
        out.push({ id, header: t("combinedCols.days") });
        continue;
      }
      const column = combinedColumn(id);
      if (!column) continue;
      out.push({ id, header: columnLabel(id, column.labelKey) });
    }
    return out;
  }, [columns.visibleIds, columnLabel, t]);

  const zoneCategoryLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const key of ZONE_CATEGORY_KEYS) labels[key] = t(`zoneCategory.${key}`);
    return labels;
  }, [t]);

  // SOP §9: the menu names the block "Daily columns (1-OCT … 31-OCT)".
  const dailyGroupLabel = useMemo(() => {
    const from = month.dates[0];
    const to = month.dates[month.dates.length - 1];
    return from && to
      ? t("combinedColumns.dailyGroup", { from: isoDayLabel(from), to: isoDayLabel(to) })
      : t("combinedCols.days");
  }, [month.dates, t]);

  const exportRows = useCallback(
    (rows: readonly PayrollRiderRow[]) => {
      if (!canExport) return;
      void exportCombinedPayrollXlsx({
        fileKey: month.key,
        identityHeaders: {
          amId: identityHeader("amId"),
          mgId: identityHeader("mgId"),
          name: identityHeader("name"),
        },
        columns: exportColumns,
        dates: month.dates,
        dayHeaders: month.dates.map(isoDayLabel),
        rows,
        today,
        zoneCategoryLabels,
      });
    },
    [canExport, exportColumns, identityHeader, month.dates, month.key, today, zoneCategoryLabels],
  );

  // The page-header Export button writes this workbook, not the shared CSV.
  useEffect(() => {
    if (!bridge) return;
    bridge.register(() => exportRows(visibleRows));
    return () => bridge.register(null);
  }, [bridge, exportRows, visibleRows]);

  const grouped = useMemo(
    () =>
      groupRows(
        visibleRows,
        prefs.groupBy,
        {
          zone: (row) => row.zone,
          partner: (row) => row.partner,
          status: (row) => row.status,
        },
        {},
        "—",
      ),
    [prefs.groupBy, visibleRows],
  );



  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-xs leading-5 shadow-sm">
          <b>{t("combinedBannerTitle")}</b> {t("combinedBannerBody")}
        </div>
        <CombinedColumnsMenu
          columns={columns}
          labelFor={(columnId) => {
            if (columnId === COMBINED_DAYS_COLUMN_ID) return dailyGroupLabel;
            const column = combinedColumn(columnId);
            return column ? columnLabel(columnId, column.labelKey) : columnId;
          }}
          canManage={canManage}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard compact label={t("combinedKpi.riders")} value={kpis.riders} icon={Users} />
        <KpiCard
          compact
          label={t("combinedKpi.active")}
          value={kpis.active}
          icon={UserCheck}
          accent="success"
        />
        <KpiCard
          compact
          label={t("combinedKpi.avgEfficiency")}
          value={formatPct(kpis.avgEfficiency)}
          icon={Percent}
        />
        <KpiCard
          compact
          label={t("combinedKpi.activeAmericana")}
          value={kpis.activeAmericana}
          icon={Building2}
        />
        <KpiCard compact label={t("combinedKpi.activeKeeta")} value={kpis.activeKeeta} icon={Store} />
      </div>
      <PayrollListToolbar prefKey="payroll-combined" search={search} onSearchChange={setSearch} />
      <GroupedSections groups={grouped}>
        {(rows, group) => (
          <CombinedPayrollGrid
            key={group.key}
            dates={month.dates}
            rows={rows}
            today={today}
            empty={t("emptyRiders")}
            exportLabel={canExport ? t("downloadTable") : undefined}
            onExport={canExport ? exportRows : undefined}
            visibleIds={columns.visibleIds}
            headingConfig={headingConfig}
            headingManage={canManage}
            identityEdit={canManage}
            filters={filters}
            onFiltersChange={setFilters}
            sort={sort}
            onSortChange={setSort}
            footer={t("tableFootRange", {
              shown: rows.length,
              total: riders.length,
              range: month.label,
            })}
          />
        )}
      </GroupedSections>
      <PayrollLegend riders={searched} />
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-4 py-2">
          <h3 className="text-sm font-semibold">{t("manualChanges.title")}</h3>
          <p className="text-xs text-muted-foreground">{t("manualChanges.hint")}</p>
        </div>
        <ManualChangesTable
          rows={audit.data ?? []}
          labels={{
            when: t("manualChanges.when"),
            who: t("manualChanges.who"),
            rider: t("manualChanges.rider"),
            day: t("manualChanges.day"),
            original: t("manualChanges.original"),
            adjusted: t("manualChanges.adjusted"),
            reason: t("manualChanges.reason"),
            empty: t("manualChanges.empty"),
            entity: t("manualChanges.title"),
          }}
        />
      </div>
    </div>
  );
}


type ManualChangeRow = {
  id: string;
  adjustedAt: string;
  actorName: string;
  driverName: string;
  mgId: string;
  workDate: string;
  originalStatus: string | null;
  adjustedStatus: string;
  adjustedHours: number | null;
  reason: string;
};

function ManualChangesTable({
  rows,
  labels,
}: {
  rows: readonly ManualChangeRow[];
  labels: {
    when: string;
    who: string;
    rider: string;
    day: string;
    original: string;
    adjusted: string;
    reason: string;
    empty: string;
    entity: string;
  };
}) {
  const columns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "when", label: labels.when },
      { id: "who", label: labels.who, categorical: true },
      { id: "rider", label: labels.rider, locked: true, categorical: true },
      { id: "day", label: labels.day },
      { id: "original", label: labels.original },
      { id: "adjusted", label: labels.adjusted },
      { id: "reason", label: labels.reason },
    ],
    [labels.adjusted, labels.day, labels.original, labels.reason, labels.rider, labels.when, labels.who],
  );
  const prefs = useTablePrefs("payroll.manualChanges", columns);
  const matched = rows.filter((row) =>
    rowMatches(prefs.appliedQuery, [row.actorName, row.driverName, row.mgId, row.workDate, row.reason, row.adjustedStatus, row.originalStatus]),
  );
  const groups = groupTableRows(matched, prefs.groupBy, (row) => {
    if (prefs.groupBy === "who") return row.actorName;
    if (prefs.groupBy === "rider") return row.driverName;
    return "";
  });
  const ids = visibleColumnIds(prefs);
  return (
    <div>
      <ListToolbar
        prefs={prefs}
        entity={labels.entity}
        columns={columns}
        rowKind="dynamic"
        filteredCount={matched.length}
        totalCount={rows.length}
      />
      <div className="max-h-[min(240px,28dvh)] overflow-auto">
        <table className="w-max min-w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-card">
            <tr>
              {ids.map((id) => (
                <th key={id} className={TABLE_HEAD_CLASS}>{columns.find((column) => column.id === id)?.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matched.length === 0 ? (
              <tr>
                <td colSpan={Math.max(ids.length, 1)} className="px-3 py-6 text-center text-xs text-muted-foreground">{labels.empty}</td>
              </tr>
            ) : (
              groups.map((group) => (
                <Fragment key={group.key}>
                  {group.label ? (
                    <tr>
                      <td colSpan={ids.length} className="bg-muted/40 px-2 py-1 text-xs font-semibold">{groupBanner(group.label, group.rows.length)}</td>
                    </tr>
                  ) : null}
                  {group.rows.map((row) => (
                    <tr key={row.id} className="border-b border-border/60">
                      {ids.map((id) => (
                        <td key={id} className="px-2 py-1.5">
                          {id === "when" ? row.adjustedAt : null}
                          {id === "who" ? <TableNameCell name={row.actorName} /> : null}
                          {id === "rider" ? <TableNameCell name={row.driverName ? `${row.driverName} · ${row.mgId}` : row.mgId} /> : null}
                          {id === "day" ? row.workDate : null}
                          {id === "original" ? (row.originalStatus ? row.originalStatus : <EmptyCell />) : null}
                          {id === "adjusted" ? `${row.adjustedStatus}${row.adjustedHours != null ? ` · ${row.adjustedHours}h` : ""}` : null}
                          {id === "reason" ? (row.reason ? row.reason : <EmptyCell />) : null}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
