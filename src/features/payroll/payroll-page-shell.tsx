"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, FilterX, Loader2 } from "lucide-react";
import { AppEmptyState, AppPage, AppPageHeader } from "@/components/app";
import { TabBar } from "@/components/dashboard/tab-bar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { kuwaitToday } from "@/features/performance/performance-formulas";
import { EMPTY_OPS_SLICERS } from "@/features/performance/performance-ops-types";
import { bucketOf, payrollMonths, type PayrollEffBucketId } from "./payroll-formulas";
import { PayrollMonthButtons, PayrollSlicerBar } from "./payroll-chrome";
import { PayrollTab } from "./payroll-tab";
import { RequestsTab } from "./requests-tab";
import { exportPayrollViewCsv } from "./payroll-csv";
import { usePayrollSnapshot } from "./use-payroll";
import type { PayrollHubTab, PayrollSlicers } from "./payroll-types";

export function PayrollPageShell() {
  const t = useTranslations("pages.payroll");
  const { can } = useAuth();
  const canExport = can("payroll.export");
  const today = kuwaitToday();
  const months = useMemo(() => payrollMonths(today), [today]);
  const [tab, setTab] = useState<PayrollHubTab>("payroll");
  const [monthKey, setMonthKey] = useState(months[0]?.key ?? today.slice(0, 7));
  const [slicers, setSlicers] = useState<PayrollSlicers>(EMPTY_OPS_SLICERS);
  const [drill, setDrill] = useState<PayrollEffBucketId | null>(null);

  const query = usePayrollSnapshot(monthKey, slicers);
  const data = query.data;
  const month = data?.month ?? months.find((m) => m.key === monthKey) ?? months[0];

  function changeMonth(key: string) {
    setMonthKey(key);
    setDrill(null);
  }

  function changeSlicers(next: PayrollSlicers) {
    setSlicers(next);
    setDrill(null);
  }

  function clearFilters() {
    setSlicers(EMPTY_OPS_SLICERS);
    setDrill(null);
  }

  function exportHeader() {
    if (!canExport || !data || !month) return;
    const rows =
      drill == null ? data.riders : data.riders.filter((r) => bucketOf(r.efficiency) === drill);
    exportPayrollViewCsv(month.key, month.days, rows);
  }

  return (
    <AppPage className="space-y-2">
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="h-9" onClick={clearFilters}>
              <FilterX className="size-3.5" />
              {t("clearFilters")}
            </Button>
            {canExport ? (
              <Button type="button" className="h-9" onClick={exportHeader}>
                <Download className="size-3.5" />
                {t("export")}
              </Button>
            ) : null}
          </div>
        }
      />
      <TabBar
        items={[
          { id: "payroll", label: t("tabPayroll") },
          { id: "requests", label: t("tabRequests") },
        ]}
        activeId={tab}
        onSelect={(id) => setTab(id as PayrollHubTab)}
      />
      <PayrollMonthButtons months={data?.months ?? months} value={monthKey} onChange={changeMonth} />
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <PayrollSlicerBar
          slicers={slicers}
          onChange={changeSlicers}
          options={data?.options ?? { zones: [], restaurants: [], nationalities: [], sourceCompanies: [] }}
        />
      </div>
      {query.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t("loading")}
        </div>
      ) : query.isError || !data || !month ? (
        <AppEmptyState title={t("loadError")} />
      ) : tab === "payroll" ? (
        <PayrollTab
          month={month}
          kpis={data.payrollKpis}
          riders={data.riders}
          drill={drill}
          onDrill={setDrill}
          canExport={canExport}
        />
      ) : (
        <RequestsTab
          month={month}
          kpis={data.requestKpis}
          requests={data.requests}
          workflow={data.workflow}
          canExport={canExport}
        />
      )}
    </AppPage>
  );
}
