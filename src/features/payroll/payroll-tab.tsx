"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Award, CalendarOff, Percent, UserCheck, Users } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Button } from "@/components/ui/button";
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
import { PayrollSummaryTable } from "./payroll-grid";
import { OffStructureDialog } from "./off-structure-dialog";
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
  allRiders,
  drill,
  onDrill,
  canExport,
  canManage,
  onOffStructureApplied,
}: {
  month: PayrollMonthMeta;
  kpis: PayrollKpis;
  riders: readonly PayrollRiderRow[];
  allRiders: readonly PayrollRiderRow[];
  drill: PayrollEffBucketId | null;
  onDrill: (id: PayrollEffBucketId | null) => void;
  canExport: boolean;
  canManage: boolean;
  onOffStructureApplied: () => void;
}) {
  const t = useTranslations("pages.payroll");
  const [search, setSearch] = useState("");
  const [offOpen, setOffOpen] = useState(false);
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
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-[12px] leading-5 shadow-sm">
          <b>{t("payrollBannerTitle")}</b>{" "}
          {t("payrollBannerBody", { days: month.days, fixed: month.fixedDays })}
        </div>
        {canManage ? (
          <Button type="button" variant="outline" className="h-9" onClick={() => setOffOpen(true)}>
            <CalendarOff className="size-3.5" />
            {t("offStructure.open")}
          </Button>
        ) : null}
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
      <PayrollSummaryTable rows={searched} empty={t("emptyRiders")} />
      {canExport ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => exportPayrollViewCsv(month.key, month.days, searched)}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-primary hover:bg-primary/10"
          >
            {t("downloadTable")}
          </button>
        </div>
      ) : null}
      {canManage ? (
        <OffStructureDialog
          open={offOpen}
          onOpenChange={setOffOpen}
          month={month}
          riders={allRiders}
          onApplied={onOffStructureApplied}
        />
      ) : null}
    </div>
  );
}
