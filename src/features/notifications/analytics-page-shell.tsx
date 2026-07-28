"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { AppListCard } from "@/components/app/app-list-card";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NotificationsTabBar } from "./notifications-tab-bar";
import { useNotificationAnalyticsDaily, useNotificationDashboard } from "./use-notifications";

export function AnalyticsPageShell() {
  const t = useTranslations("pages.notifications");
  const locale = useLocale();
  const { data: kpis, isLoading: kpisLoading } = useNotificationDashboard();

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const filters = { fromDate: fromDate || undefined, toDate: toDate || undefined };
  const { data: daily, isLoading, refetch } = useNotificationAnalyticsDaily(filters);

  const totals = (daily ?? []).reduce(
    (acc, row) => ({
      sent: acc.sent + row.sent_count,
      delivered: acc.delivered + row.delivered_count,
      opened: acc.opened + row.opened_count,
      clicked: acc.clicked + row.clicked_count,
      failed: acc.failed + row.failed_count,
    }),
    { sent: 0, delivered: 0, opened: 0, clicked: 0, failed: 0 },
  );

  const seenRate = totals.sent > 0 ? Math.round((totals.opened / totals.sent) * 100) : 0;
  const tappedRate = totals.sent > 0 ? Math.round((totals.clicked / totals.sent) * 100) : 0;
  const tappedOfSeenRate =
    totals.opened > 0 ? Math.round((totals.clicked / totals.opened) * 100) : 0;

  return (
    <AppPage>
      <AppPageHeader
        title={t("navAnalytics")}
        description={t("analyticsSubtitle")}
        breadcrumbs={[
          { label: t("title"), href: `/${locale}/notifications` },
          { label: t("navAnalytics") },
        ]}
      />

      <NotificationsTabBar />

      <KpiGrid
        items={[
          { label: t("kpiSent"), value: kpisLoading ? "…" : String(kpis?.sentToday ?? 0) },
          { label: t("kpiDeliveryRate"), value: kpisLoading ? "…" : `${kpis?.deliveryRate ?? 0}%` },
          { label: t("kpiOpenRate"), value: kpisLoading ? "…" : `${kpis?.openRate ?? 0}%` },
          { label: t("kpiFailed"), value: kpisLoading ? "…" : String(kpis?.failedDeliveries ?? 0) },
        ]}
      />

      <AppListCard title={t("analyticsDailyTitle")} className="mt-4">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>{t("analyticsFromDate")}</Label>
              <Input className="h-9" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t("analyticsToDate")}</Label>
              <Input className="h-9" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <Button variant="outline" className="h-9 cursor-pointer" onClick={() => void refetch()}>
              {t("refresh")}
            </Button>
          </div>

          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <p className="text-sm font-medium">{t("analyticsFunnelTitle")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("analyticsFunnelHint")}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <p className="text-xs text-muted-foreground">{t("analyticsFunnelSent")}</p>
                <p className="font-semibold">{isLoading ? "…" : totals.sent}</p>
              </div>
              <span className="text-muted-foreground">→</span>
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <p className="text-xs text-muted-foreground">{t("analyticsFunnelSeen")}</p>
                <p className="font-semibold">
                  {isLoading ? "…" : `${totals.opened} (${seenRate}%)`}
                </p>
              </div>
              <span className="text-muted-foreground">→</span>
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <p className="text-xs text-muted-foreground">{t("analyticsFunnelTapped")}</p>
                <p className="font-semibold">
                  {isLoading ? "…" : `${totals.clicked} (${tappedRate}% ${t("analyticsFunnelOfSent")}, ${tappedOfSeenRate}% ${t("analyticsFunnelOfSeen")})`}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-5">
            {[
              { label: t("analyticsTotalSent"), value: totals.sent },
              { label: t("analyticsTotalDelivered"), value: totals.delivered },
              { label: t("analyticsTotalOpened"), value: totals.opened },
              { label: t("analyticsTotalClicked"), value: totals.clicked },
              { label: t("analyticsTotalFailed"), value: totals.failed },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="text-lg font-semibold">{isLoading ? "…" : item.value}</p>
              </div>
            ))}
          </div>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : !daily?.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("analyticsEmpty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("analyticsDate")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colTitle")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("analyticsSent")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("analyticsDelivered")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("analyticsOpened")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("analyticsClicked")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("analyticsFailed")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {daily.map((row) => (
                  <TableRow key={`${row.metric_date}-${row.campaign_id}`}>
                    <TableCell>{row.metric_date}</TableCell>
                    <TableCell>
                      {row.campaign?.title ?? (
                        <span className="font-mono text-xs text-muted-foreground">{row.campaign_id.slice(0, 8)}</span>
                      )}
                    </TableCell>
                    <TableCell>{row.sent_count}</TableCell>
                    <TableCell>{row.delivered_count}</TableCell>
                    <TableCell>{row.opened_count}</TableCell>
                    <TableCell>{row.clicked_count}</TableCell>
                    <TableCell>{row.failed_count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </AppListCard>
    </AppPage>
  );
}
