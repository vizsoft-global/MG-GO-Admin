"use client";

import { useCallback, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, CalendarOff, Download, FilterX, Loader2, ScrollText } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { AppEmptyState, AppPage, AppPageHeader } from "@/components/app";
import { TabBar } from "@/components/dashboard/tab-bar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { kuwaitToday } from "@/features/performance/performance-formulas";
import { EMPTY_OPS_SLICERS } from "@/features/performance/performance-ops-types";
import { queryKeys } from "@/lib/query/query-keys";
import type { Permission } from "@/lib/auth/permissions";
import {
  computePayrollKpis,
  computeRequestKpis,
  filterRidersByStatus,
  keepSelectedPayrollOptions,
  payrollPeriodForPreset,
  riderMatchesSlicers,
  workflowStats,
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
import { PayrollAdjustProvider } from "./payroll-adjust-context";
import { PayrollStatusContextProvider } from "./payroll-status-context";
import { statusFilterLabels } from "./payroll-status-options";
import { listPayrollRiderStatuses, savePayrollRiderStatus } from "./payroll-actions";
import { PayrollLegend } from "./payroll-grid";
import { PayrollTab } from "./payroll-tab";
import { CombinedPayrollTab } from "./combined-tab";
import { PayrollAttendanceOrdersTab } from "./payroll-attendance-orders-tab";
import { ApplicationAttendanceTab } from "./application-attendance-tab";
import { PayrollSettingsTab } from "./payroll-settings-tab";
import { RequestsTab } from "./requests-tab";
import { OffStructureDialog } from "./off-structure-dialog";
import {
  configByKey,
  exportLabelsFromConfig,
  hiddenSetFor,
} from "./payroll-column-config";
import { exportPayrollHubCsv } from "./payroll-csv";
import { usePayrollColumnConfig, usePayrollRangeSnapshot } from "./use-payroll";
import type { PayrollHubTab, PayrollSlicers } from "./payroll-types";

const TABS: PayrollHubTab[] = [
  "payroll",
  "combined",
  "attendance-orders",
  "app-attendance",
  "requests",
  "settings",
];

const TAB_PERMISSION: Record<PayrollHubTab, Permission> = {
  payroll: "payroll.payroll",
  combined: "payroll.combined",
  "attendance-orders": "payroll.attendance_orders",
  "app-attendance": "payroll.app_attendance",
  requests: "payroll.requests",
  settings: "payroll.settings",
};

export function PayrollPageShell({ initialTab = "payroll" }: { initialTab?: PayrollHubTab }) {
  const t = useTranslations("pages.payroll");
  const locale = useLocale();
  const router = useRouter();
  const { can } = useAuth();
  const canExport = can("payroll.export");
  const canManage = can("payroll.manage");
  const queryClient = useQueryClient();
  const today = kuwaitToday();
  const [requestedTab, setTab] = useState<PayrollHubTab>(initialTab);
  const allowedTabs = useMemo<PayrollHubTab[]>(() => {
    const permitted = TABS.filter((id) => canManage || can(TAB_PERMISSION[id]));
    return permitted.length ? permitted : [TABS[0]];
  }, [can, canManage]);
  const tab = allowedTabs.includes(requestedTab) ? requestedTab : allowedTabs[0];
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

  // The snapshot is fetched whole. Every filter below runs on the client, so a
  // slicer click repaints the table on the same tick instead of waiting for the
  // RPC (whose placeholder data used to keep the previous view on screen).
  const query = usePayrollRangeSnapshot(period, EMPTY_OPS_SLICERS);
  const headings = usePayrollColumnConfig();
  const data = query.data;
  const month = data?.month ?? period;
  const headingConfig = useMemo(() => configByKey(headings.data), [headings.data]);
  const fallbackLabel = useCallback((key: string) => t(`riderCols.${key}`), [t]);

  const statusQuery = useQuery({
    queryKey: queryKeys.payroll.riderStatuses(),
    queryFn: listPayrollRiderStatuses,
    staleTime: 60_000,
  });
  const [savingId, setSavingId] = useState<string | null>(null);
  const rosterRiders = useMemo(() => {
    const all = data?.riders ?? [];
    const byDriver = statusQuery.data?.byDriver;
    if (!byDriver) return all;
    return all.map((row) => {
      const override = byDriver[row.driverId];
      return override ? { ...row, statusOverride: override } : row;
    });
  }, [data?.riders, statusQuery.data]);
  const statusLabels = useMemo(
    () =>
      statusFilterLabels(
        statusQuery.data?.customs ?? [],
        Object.values(statusQuery.data?.byDriver ?? {}).map((entry) => entry.label),
      ),
    [statusQuery.data],
  );
  const saveStatus = useCallback(
    async (driverId: string, choice: { key: string; label: string } | null) => {
      setSavingId(driverId);
      try {
        const next = await savePayrollRiderStatus(driverId, choice);
        queryClient.setQueryData(queryKeys.payroll.riderStatuses(), next);
      } finally {
        setSavingId(null);
      }
    },
    [queryClient],
  );

  const slicedRiders = useMemo(() => {
    const all = rosterRiders;
    if (!hasSlicers(slicers)) return all;
    return all.filter((rider) =>
      riderMatchesSlicers(
        {
          zoneId: rider.zoneId,
          projectKey: rider.projectKey,
          vehicleKey: rider.vehicleKey,
          // `nationality` on the row is the display label; the slicer stores codes.
          nationality: rider.nationalityCode,
          sourceType: rider.sourceType,
          sourceCompany: rider.sourceCompany,
          restaurantId: rider.restaurantId,
        },
        slicers,
      ),
    );
  }, [rosterRiders, slicers]);

  const filteredRiders = useMemo(() => {
    const byStatus = filterRidersByStatus(slicedRiders, statusFilter);
    return zoneCategory ? byStatus.filter((r) => r.zoneCategory === zoneCategory) : byStatus;
  }, [slicedRiders, statusFilter, zoneCategory]);

  const slicedRiderIds = useMemo(() => {
    if (!hasSlicers(slicers)) return null;
    return new Set(slicedRiders.map((rider) => rider.driverId));
  }, [slicedRiders, slicers]);

  const requests = useMemo(() => {
    const all = data?.requests ?? [];
    if (!slicedRiderIds) return all;
    return all.filter((request) => slicedRiderIds.has(request.driverId));
  }, [data?.requests, slicedRiderIds]);

  const requestKpis = useMemo(
    () => (slicedRiderIds ? computeRequestKpis(requests) : (data?.requestKpis ?? computeRequestKpis(requests))),
    [data?.requestKpis, requests, slicedRiderIds],
  );

  const workflow = useMemo(
    () =>
      slicedRiderIds
        ? workflowStats(requests, slicedRiders.length)
        : (data?.workflow ?? workflowStats(requests, slicedRiders.length)),
    [data?.workflow, requests, slicedRiderIds, slicedRiders.length],
  );

  const payrollKpis = useMemo(() => {
    const next = computePayrollKpis(filteredRiders);
    return { ...next, riders: slicedRiders.length };
  }, [filteredRiders, slicedRiders.length]);

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

  function clearCustomRange() {
    setCustomRange(null);
    changePreset("thisMonth");
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
    const view =
      tab === "combined"
        ? "combined"
        : tab === "attendance-orders"
          ? "ao"
          : tab === "app-attendance"
            ? "app_attendance"
            : null;
    exportPayrollHubCsv({
      tab,
      fileKey: month.key,
      dates: month.dates,
      riders: filteredRiders,
      requests,
      options: {
        ...(view
          ? {
              labels: exportLabelsFromConfig(headingConfig, fallbackLabel),
              hidden: hiddenSetFor(view, headingConfig),
            }
          : {}),
        today,
      },
      tileLabel: (key) => t(`tiles.${key}`),
      statusLabel: (status) => t(`status.${status}`),
    });
  }

  function refreshSnapshot() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.payroll.all() });
  }

  return (
    <PayrollStatusContextProvider
      value={{ canEdit: tab === "attendance-orders" && canManage, labels: statusLabels, savingId, save: saveStatus }}
    >
    <AppPage className="space-y-2">
      <PayrollAdjustProvider>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={() => router.push("/payroll/pay-plan")}
            >
              <Calculator className="size-3.5" />
              {t("payPlan.title")}
            </Button>
            {canManage || can("drivers.manage") ? (
              <Button
                type="button"
                variant="outline"
                className="h-9"
                onClick={() => router.push("/settings/sponsorships")}
              >
                <ScrollText className="size-3.5" />
                {t("sponsorship.title")}
              </Button>
            ) : null}
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
            {canExport && tab !== "settings" ? (
              <Button type="button" className="h-9" onClick={exportHeader}>
                <Download className="size-3.5" />
                {t("export")}
              </Button>
            ) : null}
          </div>
        }
      />
      <TabBar
        items={allowedTabs.map((id) => ({
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
        onClearCustom={clearCustomRange}
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
          <span className="text-xs font-semibold text-amber-900">{t("slicerCardTitle")}</span>
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
          canManage={canManage}
          today={today}
        />
      ) : tab === "combined" ? (
        <CombinedPayrollTab
          month={month}
          riders={filteredRiders}
          canExport={canExport}
          canManage={canManage}
          today={today}
        />
      ) : tab === "attendance-orders" ? (
        <PayrollAttendanceOrdersTab
          month={month}
          riders={filteredRiders}
          canExport={canExport}
          canManage={canManage}
          today={today}
        />
      ) : tab === "app-attendance" ? (
        <ApplicationAttendanceTab
          month={month}
          riders={filteredRiders}
          canExport={canExport}
          canManage={canManage}
          today={today}
        />
      ) : tab === "requests" ? (
        <RequestsTab
          month={month}
          kpis={requestKpis}
          requests={requests}
          workflow={workflow}
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
      </PayrollAdjustProvider>
    </AppPage>
    </PayrollStatusContextProvider>
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
    case "app-attendance":
      return "AppAttendance";
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

function hasSlicers(slicers: PayrollSlicers): boolean {
  return (
    slicers.zoneIds.length > 0 ||
    slicers.projectKeys.length > 0 ||
    slicers.vehicleKeys.length > 0 ||
    slicers.nationalities.length > 0 ||
    slicers.sourceTypes.length > 0 ||
    slicers.sourceCompanies.length > 0 ||
    slicers.restaurantIds.length > 0
  );
}
