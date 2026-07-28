"use client";

import { AlertTriangle, CheckCircle2, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { MetricTile } from "@/components/ui/metric-tile";
import type { PayrollReadinessSummary } from "../types";
import { DashboardWidget } from "./dashboard-widget";

export function PayrollReadinessWidget({
  summary,
  locale,
}: {
  summary: PayrollReadinessSummary;
  locale: string;
}) {
  const t = useTranslations("pages.dashboard");
  const blockers = summary.rows.filter((r) => r.anomalies.length > 0);

  return (
    <DashboardWidget
      title={t("widgetPayrollReadiness")}
      href={`/${locale}/earnings`}
      viewAllLabel={t("viewAll")}
      icon={Wallet}
      tone={summary.blockedCount > 0 ? "danger" : "success"}
      badge={blockers.length > 0 ? blockers.length : undefined}
    >
      <div className="grid grid-cols-2 gap-2 border-b border-border p-4 sm:grid-cols-3">
        <MetricTile
          label={t("payrollReady")}
          value={summary.readyCount}
          icon={CheckCircle2}
          tone="success"
          className="p-2.5"
        />
        <MetricTile
          label={t("payrollBlocked")}
          value={summary.blockedCount}
          icon={AlertTriangle}
          tone={summary.blockedCount > 0 ? "danger" : "neutral"}
          className="p-2.5"
        />
        <MetricTile
          label={t("payrollEstimated")}
          value={`${summary.totalEstimatedKwd.toFixed(3)}`}
          icon={Wallet}
          tone="primary"
          className="col-span-2 p-2.5 sm:col-span-1"
        />
      </div>
      <ul className="divide-y divide-border">
        {blockers.length === 0 ? (
          <li className="px-4 py-6 text-center text-xs text-muted-foreground">
            {t("payrollNoBlockers")}
          </li>
        ) : (
          blockers.slice(0, 5).map((row) => (
            <li
              key={row.driverId}
              className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-muted/20"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{row.driverName}</p>
                <p className="text-xs text-muted-foreground">
                  {row.anomalies.map((a) => t(`earningsAnomaly.${a}`)).join(" · ")}
                </p>
              </div>
              <span className="shrink-0 text-xs font-medium tabular-nums text-danger">
                {row.estimatedKwd.toFixed(3)} KWD
              </span>
            </li>
          ))
        )}
      </ul>
    </DashboardWidget>
  );
}
