"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { AppEmptyState, AppPage } from "@/components/app";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { kuwaitToday } from "@/features/performance/performance-formulas";
import { EMPTY_OPS_SLICERS } from "@/features/performance/performance-ops-types";
import { HrPayrollTab } from "./components/hr-payroll/hr-payroll-tab";
import { PayrollRangePills } from "./payroll-chrome";
import { OffStructureDialog } from "./off-structure-dialog";
import { PayrollPageActions } from "./payroll-page-actions";
import {
  PayrollActionsBridgeProvider,
  usePayrollActionsBridge,
} from "./payroll-actions-bridge";
import {
  payrollMonthContaining,
  payrollPeriodForPreset,
  periodFromMonthMeta,
  type PayrollRange,
  type PayrollRangePreset,
} from "./payroll-formulas";
import { usePayrollRangeSnapshot } from "./use-payroll";

export function HrPayrollPageShell() {
  const t = useTranslations("pages.payroll");
  const hub = useTranslations("pages.payrollHub.hub");
  const { can, isSuperAdmin } = useAuth();
  const canManage = can("payroll.manage");
  const router = useRouter();
  const searchParams = useSearchParams();
  const today = kuwaitToday();
  const [preset, setPreset] = useState<PayrollRangePreset>(() => {
    const value = searchParams.get("preset");
    return value === "lastMonth" || value === "custom" ? value : "thisMonth";
  });
  const [customRange, setCustomRange] = useState<PayrollRange | null>(() => {
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    return from && to ? { from, to } : null;
  });

  /**
   * Keep the chosen range in the URL, so a refresh or a shared link opens the same
   * sheet. Written only when the operator changes it — never from an effect, which
   * would fight the router on every render.
   */
  function syncRange(nextPreset: PayrollRangePreset, nextRange: PayrollRange | null) {
    setPreset(nextPreset);
    setCustomRange(nextRange);
    const next = new URLSearchParams();
    next.set("preset", nextPreset);
    if (nextRange) {
      next.set("from", nextRange.from);
      next.set("to", nextRange.to);
    }
    router.replace(`?${next.toString()}`, { scroll: false });
  }
  const [offOpen, setOffOpen] = useState(false);
  const period = useMemo(() => {
    if (preset === "custom" && customRange) {
      // HR Payroll is monthly; a mid-month range shows its month instead of
      // sending `2026-10-05_2026-10-20` and getting `invalid_month` back.
      const meta = payrollMonthContaining(customRange);
      if (meta) return periodFromMonthMeta(meta);
    }
    return payrollPeriodForPreset(preset, today, customRange);
  }, [preset, today, customRange]);
  const clampedNote =
    preset === "custom" && customRange && period.from !== customRange.from
      ? t("range.monthNote", { month: period.label })
      : null;
  const query = usePayrollRangeSnapshot(period, EMPTY_OPS_SLICERS);
  const queryClient = useQueryClient();
  const data = query.data;
  const month = data?.month ?? period;

  return (
    <PayrollActionsBridgeProvider>
    <AppPage className="flex h-[calc(100dvh-1.5rem)] min-h-0 flex-col gap-2 space-y-0 overflow-hidden">
      <div className="flex min-h-0 items-start justify-between gap-2">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/payroll-hub">{hub("breadcrumb")}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{hub("cards.hrPayroll.title")}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        {/* One shared action bar + the shared range pills, exactly as Payroll hub. */}
        <div className="flex flex-col items-end gap-2">
          <HrPayrollActionsBar
            onPayPlan={() => router.push("/payroll/pay-plan")}
            onSponsorships={() => router.push("/settings/sponsorships")}
            onOffStructure={() => setOffOpen(true)}
            canManage={canManage}
            canUseSettings={isSuperAdmin}
          />
          <PayrollRangePills
            today={today}
            preset={preset}
            customRange={customRange}
            onPreset={(next) => syncRange(next, null)}
            onApplyCustom={(range) => {
              syncRange("custom", range);
            }}
            onClearCustom={() => {
              syncRange("thisMonth", null);
            }}
          />
          {clampedNote ? (
            <p className="text-[11px] text-muted-foreground">{clampedNote}</p>
          ) : null}
        </div>
      </div>
      {query.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t("loading")}
        </div>
      ) : query.isError || !data ? (
        <AppEmptyState title={t("loadError")} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <HrPayrollTab
            key={month.key}
            monthKey={month.key}
            monthLabel={month.label}
            monthDays={month.days}
            riders={data.riders}
            canManage={canManage}
          />
        </div>
      )}
      {canManage ? (
        <OffStructureDialog
          open={offOpen}
          onOpenChange={setOffOpen}
          month={month}
          riders={data?.riders ?? []}
          onApplied={() => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.payroll.all() });
          }}
        />
      ) : null}
    </AppPage>
    </PayrollActionsBridgeProvider>
  );
}

/**
 * The shared action bar lives inside the bridge provider, so it can dispatch the
 * export/clear handlers the HR sheet registers. Split out because a hook cannot
 * read a provider declared in the same component's own return.
 */
function HrPayrollActionsBar({
  onPayPlan,
  onSponsorships,
  onOffStructure,
  canManage,
  canUseSettings,
}: {
  onPayPlan: () => void;
  onSponsorships: () => void;
  onOffStructure: () => void;
  canManage: boolean;
  canUseSettings: boolean;
}) {
  const bridge = usePayrollActionsBridge();
  return (
    <PayrollPageActions
      onPayPlan={onPayPlan}
      onSponsorships={onSponsorships}
      canUseSettings={canUseSettings}
      onOffStructure={onOffStructure}
      canManage={canManage}
      onClearFilters={() => bridge?.runClear()}
      onExport={() => bridge?.runExport()}
      canExport
    />
  );
}
