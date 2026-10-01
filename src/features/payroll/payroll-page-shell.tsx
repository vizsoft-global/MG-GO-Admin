"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarOff, Download, FilterX, Loader2 } from "lucide-react";
import { AppEmptyState, AppPage, AppPageHeader } from "@/components/app";
import { TabBar } from "@/components/dashboard/tab-bar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { kuwaitToday } from "@/features/performance/performance-formulas";
import { EMPTY_OPS_SLICERS } from "@/features/performance/performance-ops-types";
import { queryKeys } from "@/lib/query/query-keys";
import {
  computePayrollKpis,
  filterRidersByStatus,
  keepSelectedPayrollOptions,
  payrollPeriodForPreset,
  type PayrollRange,
  type PayrollRangePreset,
  type PayrollStatusFilter,
  type PayrollZoneCategoryFilter,
} from "./payroll-formulas";
import {
  PayrollPartnerView,
  PayrollRangePills,
  PayrollSlicerBar,
  PayrollSummaryStrip,
  PayrollZoneCategoryChips,
} from "./payroll-chrome";
import { PayrollLegend } from "./payroll-grid";
import { PayrollTab } from "./payroll-tab";
import { CombinedPayrollTab } from "./combined-tab";
import { PayrollAttendanceOrdersTab } from "./payroll-attendance-orders-tab";
import { PayrollSettingsTab } from "./payroll-settings-tab";
import { RequestsTab } from "./requests-tab";
import { OffStructureDialog } from "./off-structure-dialog";
import { exportPayrollViewCsv } from "./payroll-csv";
import { usePayrollRangeSnapshot } from "./use-payroll";
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
  const [tab, setTab] = useState<PayrollHubTab>(initialTab);
  const [preset, setPreset] = useState<PayrollRangePreset>("thisMonth");
  const [customRange, setCustomRange] = useState<PayrollRange | null>(null);
  const [slicers, setSlicers] = useState<PayrollSlicers>(EMPTY_OPS_SLICERS);
  const [statusFilter, setStatusFilter] = useState<PayrollStatusFilter | null>(null);
  const [zoneCategory, setZoneCategory] = useState<PayrollZoneCategoryFilter | null>(null);
  const [offOpen, setOffOpen] = useState(false);

  const period = useMemo(
    () => payrollPeriodForPreset(preset, today, customRange, locale),
    [preset, today, customRange, locale],
  );

  const query = usePayrollRangeSnapshot(period, slicers);
  const data = query.data;
  const month = data?.month ?? period;

  const filteredRiders = useMemo(() => {
    const byStatus = filterRidersByStatus(data?.riders ?? [], statusFilter);
    return zoneCategory ? byStatus.filter((r) => r.zoneCategory === zoneCategory) : byStatus;
  }, [data?.riders, statusFilter, zoneCategory]);

  const payrollKpis = useMemo(() => {
    const next = computePayrollKpis(filteredRiders);
    return { ...next, riders: data?.riders.length ?? 0 };
  }, [filteredRiders, data?.riders.length]);

  const selectedClients = useMemo(() => {
    const all = data?.clients ?? [];
    if (!slicers.projectKeys.length) return all;
    return all.filter((client) => slicers.projectKeys.includes(client.key));
  }, [data?.clients, slicers.projectKeys]);

  const usesLabel = useMemo(() => {
    const first = selectedClients[0];
    if (!first) return t("uses.none");
    const parts: string[] = [];
    if (first.usesZone) parts.push(t("uses.zone"));
    if (first.usesOrders) parts.push(t("uses.orders"));
    if (first.usesHours) parts.push(t("uses.hours"));
    return parts.join(" + ") || t("uses.none");
  }, [selectedClients, t]);

  const ruleCount = useMemo(() => {
    const keys = new Set(selectedClients.map((client) => client.key));
    return (data?.rules ?? []).filter((rule) => keys.has(rule.clientKey)).length;
  }, [data?.rules, selectedClients]);

  function changePreset(next: Exclude<PayrollRangePreset, "custom">) {
    setPreset(next);
    setStatusFilter(null);
    setZoneCategory(null);
  }

  function applyCustomRange(range: PayrollRange) {
    setCustomRange(range);
    setPreset("custom");
    setStatusFilter(null);
    setZoneCategory(null);
  }

  function changeSlicers(next: PayrollSlicers) {
    setSlicers(next);
    setStatusFilter(null);
    setZoneCategory(null);
  }

  function clearFilters() {
    setSlicers(EMPTY_OPS_SLICERS);
    setStatusFilter(null);
    setZoneCategory(null);
  }

  function exportHeader() {
    if (!canExport || !data) return;
    exportPayrollViewCsv(month.key, month.dates, filteredRiders);
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
            {canManage ? (
              <Button type="button" variant="outline" className="h-9" onClick={() => setOffOpen(true)}>
                <CalendarOff className="size-3.5" />
                {t("offStructure.open")}
              </Button>
            ) : null}
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
        items={TABS.map((id) => ({
          id,
          label: t(`tab${tabLabelKey(id)}`),
        }))}
        activeId={tab}
        onSelect={(id) => setTab(id as PayrollHubTab)}
      />
      <PayrollRangePills
        today={today}
        preset={preset}
        customRange={customRange}
        onPreset={changePreset}
        onApplyCustom={applyCustomRange}
      />
      <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-sm">
        <PayrollSlicerBar
          slicers={slicers}
          onChange={changeSlicers}
          options={keepSelectedPayrollOptions(
            data?.options ?? { zones: [], restaurants: [], nationalities: [], sourceCompanies: [] },
            slicers,
          )}
        />
      </div>
      <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50/40 p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-amber-900">{t("slicerCardTitle")}</span>
        </div>
        <PayrollPartnerView
          clients={data?.clients ?? []}
          riders={data?.riders ?? []}
          value={slicers.projectKeys}
          onChange={(projectKeys) => changeSlicers({ ...slicers, projectKeys })}
        />
        {data ? (
          <PayrollZoneCategoryChips
            riders={data.riders}
            value={zoneCategory}
            onChange={(next) => setZoneCategory(next)}
          />
        ) : null}
        <PayrollSummaryStrip
          riders={data?.riders ?? []}
          ruleCount={ruleCount}
          usesLabel={usesLabel}
        />
      </div>
      {data && tab !== "settings" ? (
        <PayrollLegend
          riders={data.riders}
          selected={statusFilter}
          onSelect={(status) => setStatusFilter(status)}
        />
      ) : null}
      {query.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t("loading")}
        </div>
      ) : query.isError || !data ? (
        <AppEmptyState title={t("loadError")} />
      ) : tab === "payroll" ? (
        <PayrollTab
          month={month}
          kpis={payrollKpis}
          riders={filteredRiders}
          canExport={canExport}
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
          riders={data.riders}
          canManage={canManage}
        />
      )}
      {canManage ? (
        <OffStructureDialog
          open={offOpen}
          onOpenChange={setOffOpen}
          month={month}
          riders={data?.riders ?? []}
          onApplied={refreshSnapshot}
        />
      ) : null}
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
