"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Award, Clock, Hand, Percent, UserCheck, Users } from "lucide-react";
import { GroupedSections, groupRows } from "@/components/app/app-list-controls";
import { AppTableColumnPicker } from "@/components/app/app-table-column-picker";
import { PayrollKpiCard } from "./payroll-kpi-card";
import { kpiSelected, nextKpiSelection, riderMatchesKpi, type PayrollKpiKey } from "./payroll-kpi-selection";
import {
  useTableColumnVisibility,
  type TableColumnVisibilityOption,
} from "@/hooks/use-table-column-visibility";
import { formatPct } from "@/lib/format/percent";
import {
  payrollRiderMatchesSearch,
  type PayrollKpis,
  type PayrollPeriod,
} from "./payroll-formulas";
import { PAYROLL_SUMMARY_COLUMNS, PAYROLL_SUMMARY_LOCKED_COLUMNS, riderColumnValue } from "./payroll-rider-columns";
import { PayrollRiderCards, type PayrollCardRow } from "./payroll-rider-cards";
import { PayrollListToolbar, usePayrollListPrefs } from "./payroll-list-toolbar";
import { PayrollSummaryTable } from "./payroll-grid";
import { exportPayrollViewCsv } from "./payroll-csv";
import type { PayrollRiderRow } from "./payroll-types";

const SUMMARY_HIDDEN_BY_DEFAULT = new Set(["restaurantId", "nationality", "zoneOrders", "zoneDpd", "zoneEff"]);

export function PayrollTab({
  month,
  kpis,
  riders,
  canExport,
  canManage = false,
  today,
}: {
  month: PayrollPeriod;
  kpis: PayrollKpis;
  riders: readonly PayrollRiderRow[];
  canExport: boolean;
  canManage?: boolean;
  /** Kuwait date the page calls today; drives the Rider Status column. */
  today: string;
}) {
  const t = useTranslations("pages.payroll");
  const [search, setSearch] = useState("");
  /** The card currently narrowing the table; clicking it again clears it. */
  const [kpi, setKpi] = useState<PayrollKpiKey | null>(null);
  const { prefs, update } = usePayrollListPrefs("payroll-summary");
  const columnOptions = useMemo<TableColumnVisibilityOption[]>(
    () =>
      PAYROLL_SUMMARY_COLUMNS.map((column) => ({
        id: column.id,
        label: t(`riderCols.${column.labelKey}`),
        locked: (PAYROLL_SUMMARY_LOCKED_COLUMNS as readonly string[]).includes(column.id),
        defaultVisible: !SUMMARY_HIDDEN_BY_DEFAULT.has(column.id),
      })),
    [t],
  );
  const columnVisibility = useTableColumnVisibility("payroll:summary-columns", columnOptions);
  const visibleColumnIds = useMemo(
    () => PAYROLL_SUMMARY_COLUMNS.filter((column) => columnVisibility.isVisible(column.id)).map((column) => column.id),
    [columnVisibility.isVisible],
  );
  const searched = useMemo(
    () =>
      riders.filter(
        (r) =>
          payrollRiderMatchesSearch(r, search) &&
          riderMatchesKpi(
            {
              status: r.status,
              efficiency: r.efficiency,
              unjustified: r.unjustified,
              days: r.days,
              adjusted: r.dayInfo.some((info) => Boolean(info?.adjusted)),
            },
            kpi,
          ),
      ),
    [riders, search, kpi],
  );
  const grouped = useMemo(
    () =>
      groupRows(
        searched,
        prefs.groupBy,
        {
          zone: (row) => row.zone,
          partner: (row) => row.partner,
          status: (row) => row.status,
        },
        {},
        "—",
      ),
    [prefs.groupBy, searched],
  );

  const cards = useMemo<PayrollCardRow[]>(
    () =>
      searched.map((row) => ({
        id: row.driverId,
        code: row.amId || "—",
        name: row.name || "—",
        driverId: row.driverId,
        fields: [
          { label: t("riderCols.mgId"), value: row.mgId || "—" },
          { label: t("riderCols.zone"), value: row.zone || "—" },
          { label: t("riderCols.finalOrders"), value: String(row.finalOrders) },
          { label: t("riderCols.status"), value: String(riderColumnValue(row, "status", today) ?? "—") },
        ],
      })),
    [searched, t, today],
  );

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-xs leading-5 shadow-sm">
        <b>{t("payrollBannerTitle")}</b>{" "}
        {t("payrollBannerBody", { days: month.days, fixed: month.fixedDays })}
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-7">
        <PayrollKpiCard
          label={t("kpi.riders")}
          value={kpis.riders}
          icon={Users}
          selected={kpi === null}
          empty={kpis.riders === 0}
          emptyHint={t("kpi.emptyHint")}
          onSelect={() => setKpi(null)}
        />
        <PayrollKpiCard
          label={t("kpi.active")}
          value={kpis.active}
          icon={UserCheck}
          accent="success"
          selected={kpiSelected(kpi, "active")}
          empty={kpis.riders === 0}
          emptyHint={t("kpi.emptyHint")}
          onSelect={() => setKpi((current) => nextKpiSelection(current, "active"))}
        />
        <PayrollKpiCard
          label={t("kpi.avgEff")}
          value={formatPct(kpis.avgEfficiency)}
          icon={Percent}
          disabled
          empty={kpis.riders === 0}
          emptyHint={t("kpi.emptyHint")}
          disabledHint={t("kpi.avgEffHint")}
        />
        <PayrollKpiCard
          label={t("kpi.atOrAbove100")}
          value={kpis.atOrAbove100}
          icon={Award}
          accent="success"
          selected={kpiSelected(kpi, "atOrAbove100")}
          empty={kpis.riders === 0}
          emptyHint={t("kpi.emptyHint")}
          onSelect={() => setKpi((current) => nextKpiSelection(current, "atOrAbove100"))}
        />
        <PayrollKpiCard
          label={t("kpi.unjustified")}
          value={kpis.unjustifiedRiders}
          icon={AlertTriangle}
          accent="warning"
          selected={kpiSelected(kpi, "unjustified")}
          empty={kpis.riders === 0}
          emptyHint={t("kpi.emptyHint")}
          onSelect={() => setKpi((current) => nextKpiSelection(current, "unjustified"))}
        />
        <PayrollKpiCard
          label={t("kpi.reduced3Days")}
          value={kpis.reduced3Days}
          icon={Clock}
          caption={t("kpi.ridersCaption")}
          selected={kpiSelected(kpi, "reduced3Days")}
          empty={kpis.riders === 0}
          emptyHint={t("kpi.emptyHint")}
          onSelect={() => setKpi((current) => nextKpiSelection(current, "reduced3Days"))}
        />
        <PayrollKpiCard
          label={t("kpi.manualAdjustments")}
          value={kpis.manualAdjustments}
          icon={Hand}
          accent="warning"
          caption={t("kpi.ridersCaption")}
          selected={kpiSelected(kpi, "manualAdjustments")}
          empty={kpis.riders === 0}
          emptyHint={t("kpi.emptyHint")}
          onSelect={() => setKpi((current) => nextKpiSelection(current, "manualAdjustments"))}
        />
      </div>
      <PayrollListToolbar
        prefKey="payroll-summary"
        search={search}
        onSearchChange={setSearch}
        prefs={prefs}
        onUpdate={update}
        trailing={
          <AppTableColumnPicker
            options={columnVisibility.pickerOptions}
            isVisible={columnVisibility.isVisible}
            onToggle={columnVisibility.toggle}
            onReset={columnVisibility.reset}
            sourceLabel={t("tabPayroll")}
            hiddenCount={columnVisibility.hiddenToggleableCount}
          />
        }
      />
      {prefs.viewMode === "cards" ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <PayrollRiderCards rows={cards} empty={t("emptyRiders")} />
        </div>
      ) : (
        <GroupedSections groups={grouped}>
          {(rows) => (
            <PayrollSummaryTable
              rows={rows}
              empty={t("emptyRiders")}
              rangeLabel={month.label}
              visibleColumnIds={visibleColumnIds}
              today={today}
              canManage={canManage}
              exportLabel={canExport ? t("downloadTable") : undefined}
              onExport={
                canExport
                  ? (visible) => exportPayrollViewCsv(month.key, month.dates, visible, { today })
                  : undefined
              }
            />
          )}
        </GroupedSections>
      )}
    </div>
  );
}

