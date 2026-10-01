"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Award, Clock, Hand, Percent, UserCheck, Users } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Input } from "@/components/ui/input";
import {
  payrollRiderMatchesSearch,
  type PayrollKpis,
  type PayrollPeriod,
} from "./payroll-formulas";
import { PayrollNewTag } from "./payroll-chrome";
import { PayrollSummaryTable } from "./payroll-grid";
import { exportPayrollViewCsv } from "./payroll-csv";
import type { PayrollRiderRow } from "./payroll-types";

export function PayrollTab({
  month,
  kpis,
  riders,
  canExport,
}: {
  month: PayrollPeriod;
  kpis: PayrollKpis;
  riders: readonly PayrollRiderRow[];
  canExport: boolean;
}) {
  const t = useTranslations("pages.payroll");
  const [search, setSearch] = useState("");
  const searched = useMemo(
    () => riders.filter((r) => payrollRiderMatchesSearch(r, search)),
    [riders, search],
  );

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-[12px] leading-5 shadow-sm">
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
          caption={<PayrollNewTag />}
          value={kpis.reduced3Days}
          icon={Clock}
        />
        <KpiCard
          compact
          label={t("kpi.manualAdjustments")}
          caption={<PayrollNewTag />}
          value={kpis.manualAdjustments}
          icon={Hand}
          accent="warning"
        />
      </div>
      <Input
        className="h-9"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("searchPlaceholder")}
      />
      <PayrollSummaryTable
        rows={searched}
        empty={t("emptyRiders")}
        rangeLabel={month.label}
        exportLabel={canExport ? t("downloadTable") : undefined}
        onExport={
          canExport ? (visible) => exportPayrollViewCsv(month.key, month.dates, visible) : undefined
        }
      />
    </div>
  );
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}
