"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
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
import { kuwaitToday } from "@/features/performance/performance-formulas";
import { EMPTY_OPS_SLICERS } from "@/features/performance/performance-ops-types";
import { HrPayrollTab } from "./components/hr-payroll/hr-payroll-tab";
import { PayrollRangePills } from "./payroll-chrome";
import {
  payrollPeriodForPreset,
  type PayrollRange,
  type PayrollRangePreset,
} from "./payroll-formulas";
import { usePayrollRangeSnapshot } from "./use-payroll";

export function HrPayrollPageShell() {
  const t = useTranslations("pages.payroll");
  const hub = useTranslations("pages.payrollHub.hub");
  const { can } = useAuth();
  const canManage = can("payroll.manage");
  const today = kuwaitToday();
  const [preset, setPreset] = useState<PayrollRangePreset>("thisMonth");
  const [customRange, setCustomRange] = useState<PayrollRange | null>(null);
  const period = useMemo(
    () => payrollPeriodForPreset(preset, today, customRange),
    [preset, today, customRange],
  );
  const query = usePayrollRangeSnapshot(period, EMPTY_OPS_SLICERS);
  const data = query.data;
  const month = data?.month ?? period;

  return (
    <AppPage className="flex h-[calc(100dvh-1.5rem)] min-h-0 flex-col gap-2 space-y-0 overflow-hidden">
      <div className="flex min-h-0 items-center justify-between gap-2">
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
        <PayrollRangePills
        today={today}
        preset={preset}
        customRange={customRange}
        onPreset={setPreset}
        onApplyCustom={(range) => {
          setCustomRange(range);
          setPreset("custom");
        }}
        onClearCustom={() => {
          setCustomRange(null);
          setPreset("thisMonth");
        }}
        />
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
    </AppPage>
  );
}
