"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Download, FilterX, Loader2 } from "lucide-react";
import { AppEmptyState, AppPage, AppPageHeader } from "@/components/app";
import { TabBar } from "@/components/dashboard/tab-bar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { kuwaitToday } from "@/features/performance/performance-formulas";
import { EMPTY_OPS_SLICERS } from "@/features/performance/performance-ops-types";
import { queryKeys } from "@/lib/query/query-keys";
import {
  bucketOf,
  computePayrollKpis,
  filterRidersByStatus,
  keepSelectedPayrollOptions,
  monthMeta,
  payrollMonthForPreset,
  payrollMonths,
  presetForPayrollMonth,
  type PayrollEffBucketId,
  type PayrollRangePreset,
  type PayrollStatusFilter,
  type PayrollZoneCategoryFilter,
} from "./payroll-formulas";
import {
  PayrollPartnerView,
  PayrollRangePills,
  PayrollSlicerBar,
  PayrollZoneCategoryChips,
} from "./payroll-chrome";
import { PayrollLegend } from "./payroll-grid";
import { PayrollTab } from "./payroll-tab";
import { CombinedPayrollTab } from "./combined-tab";
import { PayrollAttendanceOrdersTab } from "./payroll-attendance-orders-tab";
import { PayrollSettingsTab } from "./payroll-settings-tab";
import { RequestsTab } from "./requests-tab";
import { exportPayrollViewCsv } from "./payroll-csv";
import { usePayrollSnapshot } from "./use-payroll";
import type { PayrollHubTab, PayrollSlicers } from "./payroll-types";

const TABS: PayrollHubTab[] = ["payroll", "combined", "attendance-orders", "requests", "settings"];

export function PayrollPageShell({ initialTab = "payroll" }: { initialTab?: PayrollHubTab }) {
  const t = useTranslations("pages.payroll");
  const locale = useLocale();
  const { can } = useAuth();
  const canExport = can("payroll.export");
  const canManage = can("payroll.manage");
  const queryClient = useQueryClient();
  const today = kuwaitToday();
  const months = useMemo(() => payrollMonths(today, locale), [today, locale]);
  const [tab, setTab] = useState<PayrollHubTab>(initialTab);
  const [preset, setPreset] = useState<PayrollRangePreset>("thisMonth");
  const [customKey, setCustomKey] = useState<string | null>(null);
  const monthKey = useMemo(() => {
    try {
      return payrollMonthForPreset(preset, today, customKey).key;
    } catch {
      return months[0]?.key ?? today.slice(0, 7);
    }
  }, [preset, today, customKey, months]);
  const [slicers, setSlicers] = useState<PayrollSlicers>(EMPTY_OPS_SLICERS);
  const [drill, setDrill] = useState<PayrollEffBucketId | null>(null);
  const [statusFilter, setStatusFilter] = useState<PayrollStatusFilter | null>(null);
  const [zoneCategory, setZoneCategory] = useState<PayrollZoneCategoryFilter | null>(null);

  const query = usePayrollSnapshot(monthKey, slicers);
  const data = query.data;
  const month = useMemo(() => {
    const raw = data?.month ?? months.find((m) => m.key === monthKey) ?? months[0];
    if (!raw) return raw;
    const localized = monthMeta(raw.key, locale);
    return localized ? { ...raw, label: localized.label } : raw;
  }, [data?.month, months, monthKey, locale]);

  const filteredRiders = useMemo(() => {
    const byStatus = filterRidersByStatus(data?.riders ?? [], statusFilter);
    return zoneCategory ? byStatus.filter((r) => r.zoneCategory === zoneCategory) : byStatus;
  }, [data?.riders, statusFilter, zoneCategory]);

  const payrollKpis = useMemo(() => {
    const next = computePayrollKpis(filteredRiders);
    return { ...next, riders: data?.riders.length ?? 0 };
  }, [filteredRiders, data?.riders.length]);

  function changePreset(next: Exclude<PayrollRangePreset, "custom">) {
    setPreset(next);
    setDrill(null);
    setStatusFilter(null);
    setZoneCategory(null);
  }

  function applyCustomMonth(key: string) {
    setCustomKey(key);
    setPreset(presetForPayrollMonth(key, today));
    setDrill(null);
    setStatusFilter(null);
    setZoneCategory(null);
  }

  function changeSlicers(next: PayrollSlicers) {
    setSlicers(next);
    setDrill(null);
    setStatusFilter(null);
    setZoneCategory(null);
  }

  function clearFilters() {
    setSlicers(EMPTY_OPS_SLICERS);
    setDrill(null);
    setStatusFilter(null);
    setZoneCategory(null);
  }

  function exportHeader() {
    if (!canExport || !data || !month) return;
    const rows =
      drill == null
        ? filteredRiders
        : filteredRiders.filter((r) => bucketOf(r.efficiency) === drill);
    exportPayrollViewCsv(month.key, month.days, rows);
  }

  function refreshSnapshot() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.payroll.all() });
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
        items={TABS.map((id) => ({ id, label: t(`tab${tabLabelKey(id)}`) }))}
        activeId={tab}
        onSelect={(id) => setTab(id as PayrollHubTab)}
      />
      <PayrollRangePills
        today={today}
        preset={preset}
        customKey={customKey}
        onPreset={changePreset}
        onApplyCustom={applyCustomMonth}
      />
      <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-sm">
        <PayrollPartnerView
          riders={data?.riders ?? []}
          value={slicers.projectKeys}
          onChange={(projectKeys) => changeSlicers({ ...slicers, projectKeys })}
        />
        {data ? (
          <PayrollZoneCategoryChips
            riders={data.riders}
            value={zoneCategory}
            onChange={(next) => {
              setZoneCategory(next);
              setDrill(null);
            }}
          />
        ) : null}
        <PayrollSlicerBar
          slicers={slicers}
          onChange={changeSlicers}
          options={keepSelectedPayrollOptions(
            data?.options ?? { zones: [], restaurants: [], nationalities: [], sourceCompanies: [] },
            slicers,
          )}
        />
      </div>
      {data && tab !== "settings" ? (
        <PayrollLegend
          riders={data.riders}
          selected={statusFilter}
          onSelect={(status) => {
            setStatusFilter(status);
            setDrill(null);
          }}
        />
      ) : null}
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
          kpis={payrollKpis}
          riders={filteredRiders}
          allRiders={data.riders}
          drill={drill}
          onDrill={setDrill}
          canExport={canExport}
          canManage={canManage}
          onOffStructureApplied={refreshSnapshot}
        />
      ) : tab === "combined" ? (
        <CombinedPayrollTab
          month={month}
          riders={filteredRiders}
          canExport={canExport}
          canManage={canManage}
        />
      ) : tab === "attendance-orders" ? (
        <PayrollAttendanceOrdersTab
          month={month}
          riders={filteredRiders}
          canExport={canExport}
        />
      ) : tab === "requests" ? (
        <RequestsTab
          month={month}
          kpis={data.requestKpis}
          requests={data.requests}
          workflow={data.workflow}
          canExport={canExport}
        />
      ) : (
        <PayrollSettingsTab
          month={month}
          zoneMetrics={data.zoneMetrics}
          canManage={canManage}
        />
      )}
    </AppPage>
  );
}

/** `attendance-orders` → `AttendanceOrders`, matching the existing key style. */
function tabLabelKey(id: PayrollHubTab): string {
  switch (id) {
    case "payroll":
      return "Payroll";
    case "combined":
      return "Combined";
    case "attendance-orders":
      return "AttendanceOrders";
    case "requests":
      return "Requests";
    case "settings":
      return "Settings";
    default: {
      const never: never = id;
      return never;
    }
  }
}
