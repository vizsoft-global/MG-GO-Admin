"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Building2, Percent, Store, UserCheck, Users } from "lucide-react";
import { GroupedSections, groupRows } from "@/components/app/app-list-controls";
import { formatPct } from "@/lib/format/percent";
import {
  companyDayHours,
  computeCombinedKpis,
  isoDayLabel,
  payrollRiderMatchesSearch,
  type PayrollPeriod,
} from "./payroll-formulas";
import { PayrollKpiCard } from "./payroll-kpi-card";
import {
  combinedRiderMatchesKpi,
  kpiSelected,
  nextKpiSelection,
  type CombinedKpiKey,
} from "./payroll-kpi-selection";
import { PayrollListToolbar, usePayrollListPrefs } from "./payroll-list-toolbar";
import { PayrollLegend } from "./payroll-grid";
import { PayrollManualChangesPanel } from "./payroll-manual-changes";
import {
  COMBINED_DAYS_COLUMN_ID,
  COMBINED_NUMERIC_IDS,
  combinedColumn,
  combinedRowValues,
} from "./combined-columns";
import { CombinedColumnsMenu } from "./combined-columns-menu";
import { CombinedPayrollGrid } from "./combined-grid";
import { PayrollRiderCards } from "./payroll-rider-cards";
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
import { payrollColumnLabel } from "./payroll-column-labels";
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
  const { prefs, update } = usePayrollListPrefs("payroll-combined");
  const audit = usePayrollAdjustmentAudit({ from: month.from, to: month.to });
  const headings = usePayrollColumnConfig();
  const headingConfig = useMemo(() => configByKey(headings.data), [headings.data]);
  const columns = useCombinedColumns();
  const bridge = useCombinedExportBridge();
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [sort, setSort] = useState<ColumnSort>(null);
  /** The card narrowing this sheet; pressing it again clears it. */
  const [kpi, setKpi] = useState<CombinedKpiKey | null>(null);

  const cardRiders = useMemo(
    () =>
      riders.filter((row) =>
        combinedRiderMatchesKpi(
          { status: row.status, keeta: companyDayHours(row.projectKey, row.partner) === 10 },
          kpi,
        ),
      ),
    [riders, kpi],
  );

  const searched = useMemo(
    () => cardRiders.filter((r) => payrollRiderMatchesSearch(r, search)),
    [cardRiders, search],
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
      const fallback = payrollColumnLabel(columnId, t(`riderCols.${columnId}`));
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
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-5">
        <PayrollKpiCard
          label={t("combinedKpi.riders")}
          value={kpis.riders}
          icon={Users}
          selected={kpi === null}
          onSelect={() => setKpi(null)}
        />
        <PayrollKpiCard
          label={t("combinedKpi.active")}
          value={kpis.active}
          icon={UserCheck}
          accent="success"
          selected={kpiSelected(kpi, "active")}
          onSelect={() => setKpi((current) => nextKpiSelection(current, "active"))}
        />
        <PayrollKpiCard
          label={t("combinedKpi.avgEfficiency")}
          value={formatPct(kpis.avgEfficiency)}
          icon={Percent}
          disabled
          disabledHint={t("kpi.avgEffHint")}
        />
        <PayrollKpiCard
          label={t("combinedKpi.activeAmericana")}
          value={kpis.activeAmericana}
          icon={Building2}
          selected={kpiSelected(kpi, "activeAmericana")}
          onSelect={() => setKpi((current) => nextKpiSelection(current, "activeAmericana"))}
        />
        <PayrollKpiCard
          label={t("combinedKpi.activeKeeta")}
          value={kpis.activeKeeta}
          icon={Store}
          selected={kpiSelected(kpi, "activeKeeta")}
          onSelect={() => setKpi((current) => nextKpiSelection(current, "activeKeeta"))}
        />
      </div>
      <PayrollListToolbar
        prefKey="payroll-combined"
        search={search}
        onSearchChange={setSearch}
        prefs={prefs}
        onUpdate={update}
        trailing={
          <CombinedColumnsMenu
            columns={columns}
            labelFor={(columnId) => {
              if (columnId === COMBINED_DAYS_COLUMN_ID) return dailyGroupLabel;
              const column = combinedColumn(columnId);
              return column ? columnLabel(columnId, column.labelKey) : columnId;
            }}
            canManage={canManage}
          />
        }
      />
      {prefs.viewMode === "cards" ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <PayrollRiderCards
            rows={visibleRows.map((row) => ({
              id: row.driverId,
              code: row.amId || "—",
              name: row.name || "—",
              driverId: row.driverId,
              fields: [
                { label: t("riderCols.mgId"), value: row.mgId || "—" },
                { label: columnLabel("proj", "projectName"), value: row.partner || "—" },
                { label: columnLabel("ord", "totalOrders"), value: String(row.finalOrders) },
                {
                  label: columnLabel("eff", "efficiency"),
                  value: formatPct(Number(combinedColumn("eff")?.value(row, valueContext) ?? 0)),
                },
              ],
            }))}
            empty={t("emptyRiders")}
          />
        </div>
      ) : (
        <GroupedSections groups={grouped}>
          {(rows, group) => (
            <CombinedPayrollGrid
              key={group.key}
              dates={month.dates}
              rows={rows}
              today={today}
              empty={t("emptyRiders")}
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
      )}
      <PayrollLegend riders={searched} />
      <PayrollManualChangesPanel
        rows={audit.data ?? []}
        title={t("manualChanges.title")}
        hint={t("manualChanges.hint")}
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
  );
}


/* The manual-changes table moved to `payroll-manual-changes.tsx`: Attendance &
 * Orders now shows the same record beside its own project, and one table means
 * the two tabs cannot disagree about what was edited. */



