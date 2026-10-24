"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Award, Clock, Hand, Percent, UserCheck, Users } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { GroupedSections, groupRows } from "@/components/app/app-list-controls";
import { AppTableColumnPicker } from "@/components/app/app-table-column-picker";
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
import { PAYROLL_SUMMARY_COLUMNS, PAYROLL_SUMMARY_LOCKED_COLUMNS } from "./payroll-rider-columns";
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
  const { prefs } = usePayrollListPrefs("payroll-summary");
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
    () => riders.filter((r) => payrollRiderMatchesSearch(r, search)),
    [riders, search],
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

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-xs leading-5 shadow-sm">
        <b>{t("payrollBannerTitle")}</b>{" "}
        {t("payrollBannerBody", { days: month.days, fixed: month.fixedDays })}
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-7">
        <KpiCard compact label={t("kpi.riders")} value={kpis.riders} icon={Users} />
        <KpiCard compact label={t("kpi.active")} value={kpis.active} icon={UserCheck} accent="success" />
        <KpiCard
          compact
          label={t("kpi.avgEff")}
          value={formatPct(kpis.avgEfficiency)}
          icon={Percent}
        />
        <KpiCard
          compact
          label={t("kpi.atOrAbove100")}
          value={kpis.atOrAbove100}
          icon={Award}
          accent="success"
        />
        <KpiCard
          compact
          label={t("kpi.unjustified")}
          value={kpis.unjustifiedRiders}
          icon={AlertTriangle}
          accent="warning"
        />
        <KpiCard
          compact
          label={t("kpi.reduced3Days")}
          value={kpis.reduced3Days}
          icon={Clock}
        />
        <KpiCard
          compact
          label={t("kpi.manualAdjustments")}
          value={kpis.manualAdjustments}
          icon={Hand}
          accent="warning"
        />
      </div>
      <PayrollListToolbar
        prefKey="payroll-summary"
        search={search}
        onSearchChange={setSearch}
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
    </div>
  );
}

