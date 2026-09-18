"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Award, Percent, UserCheck, Users } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Input } from "@/components/ui/input";
import {
  bucketOf,
  formatPayrollPct,
  payrollRiderMatchesSearch,
  type PayrollEffBucketId,
  type PayrollKpis,
  type PayrollMonthMeta,
} from "./payroll-formulas";
import { PayrollDistributionChart } from "./payroll-chart";
import { PayrollDayGrid, PayrollLegend } from "./payroll-grid";
import {
  bucketLabel,
  exportPayrollDistributionCsv,
  exportPayrollViewCsv,
} from "./payroll-csv";
import type { PayrollRiderRow } from "./payroll-types";

export function PayrollTab({
  month,
  kpis,
  riders,
  drill,
  onDrill,
  canExport,
}: {
  month: PayrollMonthMeta;
  kpis: PayrollKpis;
  riders: readonly PayrollRiderRow[];
  drill: PayrollEffBucketId | null;
  onDrill: (id: PayrollEffBucketId | null) => void;
  canExport: boolean;
}) {
  const t = useTranslations("pages.payroll");
  const [search, setSearch] = useState("");
  const visible = useMemo(
    () => (drill ? riders.filter((r) => bucketOf(r.efficiency) === drill) : riders),
    [riders, drill],
  );
  const searched = useMemo(
    () => visible.filter((r) => payrollRiderMatchesSearch(r, search)),
    [visible, search],
  );

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-[12px] leading-5 shadow-sm">
        <b>{t("payrollBannerTitle")}</b> {t("payrollBannerBody", { days: month.days, fixed: month.fixedDays })}
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <KpiCard compact label={t("kpi.riders")} value={kpis.riders} icon={Users} />
        <KpiCard compact label={t("kpi.active")} value={kpis.active} icon={UserCheck} accent="success" />
        <KpiCard
          compact
          label={t("kpi.avgEff")}
          value={formatPayrollPct(kpis.avgEfficiency)}
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
      </div>
      <PayrollLegend />
      <PayrollDistributionChart
        riders={riders}
        selected={drill}
        onSelect={onDrill}
        onExport={() => {
          if (canExport) exportPayrollDistributionCsv(month.key, riders);
        }}
        exportLabel={t("exportCsv")}
        title={t("chartTitle")}
        subtitle={t("chartSub")}
      />
      {drill ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-400/50 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">
          <span>{t("drillBanner", { bucket: bucketLabel(drill), count: searched.length })}</span>
          <button
            type="button"
            onClick={() => onDrill(null)}
            className="ms-auto h-8 rounded-md border border-emerald-500 px-2.5 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100"
          >
            {t("showAll")}
          </button>
        </div>
      ) : null}
      <Input
        className="h-9"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("searchPlaceholder")}
      />
      <PayrollDayGrid
        monthKey={month.key}
        days={month.days}
        rows={searched}
        empty={t("emptyRiders")}
        exportLabel={t("downloadTable")}
        onExport={() => {
          if (canExport) exportPayrollViewCsv(month.key, month.days, searched);
        }}
        footer={t("tableFoot", {
          shown: searched.length,
          total: riders.length,
          month: month.label,
          days: month.days,
          fixed: month.fixedDays,
        })}
      />
    </div>
  );
}
