"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Bell, Copy, Loader2, Plus, RefreshCw, Send, ShieldOff } from "lucide-react";
import { AppListCard } from "@/components/app/app-list-card";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/auth-context";
import { cloneNotificationCampaign } from "./notifications-actions";
import { NotificationsTabBar } from "./notifications-tab-bar";
import { useInfiniteNotificationCampaigns, useNotificationDashboard } from "./use-notifications";
import { resolveStatusVariant } from "@/lib/ui/resolve-status-variant";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kuwait",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function NotificationsPageShell() {
  const t = useTranslations("pages.notifications");
  const locale = useLocale();
  const auth = useAuth();
  const canManage = auth.can("notifications.manage");

  const { data: kpis, isLoading: kpisLoading, refetch: refetchKpis } = useNotificationDashboard();
  const {
    data: campaignPages,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    refetch,
  } = useInfiniteNotificationCampaigns({});

  const campaigns = useMemo(
    () => campaignPages?.pages.flatMap((page) => page.rows) ?? [],
    [campaignPages],
  );
  const totalCount = campaignPages?.pages[0]?.totalCount ?? campaigns.length;

  const tableColumns = useMemo(
    () => [
      { id: "title", label: t("colTitle") },
      { id: "category", label: t("colCategory") },
      { id: "audience", label: t("colAudience") },
      { id: "status", label: t("colStatus") },
      { id: "sent", label: t("colSent") },
      { id: "actions", label: t("colActions") },
    ],
    [t],
  );

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          canManage ? (
            <Button render={<Link href={`/${locale}/notifications/new`} />} className="h-9 cursor-pointer rounded-lg">
              <Plus className="size-4" />
              {t("createNotification")}
            </Button>
          ) : null
        }
      />

      <NotificationsTabBar />

      <KpiGrid
        items={[
          { label: t("kpiSent"), value: kpisLoading ? "…" : String(kpis?.sentToday ?? 0) },
          { label: t("kpiScheduled"), value: kpisLoading ? "…" : String(kpis?.scheduled ?? 0) },
          { label: t("kpiDrafts"), value: kpisLoading ? "…" : String(kpis?.drafts ?? 0) },
          {
            label: t("kpiDeliveryRate"),
            value: kpisLoading ? "…" : `${kpis?.deliveryRate ?? 0}%`,
          },
          {
            label: t("kpiOpenRate"),
            value: kpisLoading ? "…" : `${kpis?.openRate ?? 0}%`,
          },
          { label: t("kpiFailed"), value: kpisLoading ? "…" : String(kpis?.failedDeliveries ?? 0) },
          {
            label: t("kpiAutomations"),
            value: kpisLoading ? "…" : String(kpis?.activeAutomations ?? 0),
          },
          {
            label: t("kpiActivity"),
            value: kpisLoading ? "…" : String(kpis?.recentActivity ?? 0),
          },
        ]}
      />

      <AppListCard
        title={t("recentCampaigns")}
        headerActions={
          <Button
            variant="outline"
            size="sm"
            className="h-9 cursor-pointer"
            onClick={() => {
              void refetch();
              void refetchKpis();
            }}
          >
            <RefreshCw className="size-4" />
            {t("refresh")}
          </Button>
        }
      >
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : !campaigns.length ? (
            <AppEmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
          ) : (
            <>
              <AppDataTable columns={tableColumns}>
                {campaigns.map((row) => (
                  <AppDataTableRow key={row.id}>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link
                          href={`/${locale}/notifications/${row.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {row.title}
                        </Link>
                        {row.screenshot_restricted ? (
                          <span className="inline-flex items-center gap-0.5 rounded-md border border-amber-200 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                            <ShieldOff className="size-3" aria-hidden />
                            {t("screenshotRestrictedBadge")}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-1">{row.body}</p>
                    </TableCell>
                    <TableCell className="capitalize">{row.category.replace("_", " ")}</TableCell>
                    <TableCell>{row.estimated_audience_count || row.recipient_count || 0}</TableCell>
                    <TableCell>
                      <StatusPill variant={resolveStatusVariant(row.status)}>
                        {row.status.replace("_", " ")}
                      </StatusPill>
                    </TableCell>
                    <TableCell>{formatDateTime(row.sent_at ?? row.scheduled_for)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          render={<Link href={`/${locale}/notifications/${row.id}`} />}
                          variant="ghost"
                          size="sm"
                          className="h-8 cursor-pointer text-primary"
                        >
                          <Send className="size-3.5" />
                        </Button>
                        {canManage ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 cursor-pointer"
                            onClick={() => void cloneNotificationCampaign(row.id).then(() => refetch())}
                          >
                            <Copy className="size-3.5" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </AppDataTableRow>
                ))}
              </AppDataTable>
              <div className="flex flex-col items-center gap-2 border-t border-border py-4">
                <p className="text-xs text-muted-foreground">
                  {t("showingCount", { visible: campaigns.length, total: totalCount })}
                </p>
                {isFetchingNextPage ? (
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                ) : hasNextPage ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="cursor-pointer rounded-lg"
                    onClick={() => void fetchNextPage()}
                  >
                    {t("loadMore")}
                  </Button>
                ) : campaigns.length > 0 ? (
                  <p className="text-xs text-muted-foreground">{t("endOfList")}</p>
                ) : null}
              </div>
            </>
          )}
        </CardContent>
      </AppListCard>
    </AppPage>
  );
}
