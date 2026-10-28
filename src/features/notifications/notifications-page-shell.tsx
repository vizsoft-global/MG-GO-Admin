"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Bell,
  CalendarClock,
  CircleAlert,
  Copy,
  FileEdit,
  List,
  Loader2,
  RefreshCw,
  Send,
  ShieldOff,
} from "lucide-react";
import { AppListCard } from "@/components/app/app-list-card";
import {
  FlatListPager,
  GroupTableHeaderRow,
  fieldSearchMatch,
  groupRows,
  useGroupedListView,
} from "@/components/app/app-list-controls";
import {
  TableGridCards,
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
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
import { ToggleChip } from "@/components/app/toggle-chip";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/auth-context";
import { downloadCsv } from "@/features/driver-tracking/csv-export";
import { NOTIFICATION_CATEGORIES } from "./constants";
import { CampaignAudienceButton } from "./notification-audience-dialog";
import { NOTIFICATION_LIST_BUCKETS, type NotificationListBucket } from "./notification-list-buckets";
import { cloneNotificationCampaign, exportNotificationCampaignsCsv } from "./notifications-actions";
import { NotificationsTabBar } from "./notifications-tab-bar";
import type { NotificationListFilters } from "./types";
import { ClearAllModuleButton } from "@/features/settings/clear-all-module-button";
import { useInfiniteNotificationCampaigns, useNotificationDashboard } from "./use-notifications";
import { formatPct } from "@/lib/format/percent";
import { resolveStatusVariant } from "@/lib/ui/resolve-status-variant";

function bucketChip(id: NotificationListBucket): {
  label: "listTabAll" | "listTabSent" | "listTabDrafts" | "listTabScheduled" | "listTabFailed";
  icon: typeof List;
} {
  switch (id) {
    case "all":
      return { label: "listTabAll", icon: List };
    case "sent":
      return { label: "listTabSent", icon: Send };
    case "drafts":
      return { label: "listTabDrafts", icon: FileEdit };
    case "scheduled":
      return { label: "listTabScheduled", icon: CalendarClock };
    case "failed":
      return { label: "listTabFailed", icon: CircleAlert };
    default: {
      const neverBucket: never = id;
      return neverBucket;
    }
  }
}

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
  const canExport = auth.can("notifications.export");
  const router = useRouter();

  const toolbarColumns = useMemo((): TableToolbarColumn[] => [
    { id: "title", label: t("colTitle"), locked: true },
    { id: "category", label: t("colCategory"), categorical: true },
    { id: "audience", label: t("colAudience") },
    { id: "status", label: t("colStatus"), categorical: true },
    { id: "sent", label: t("colSent") },
    { id: "actions", label: t("colActions") },
  ], [t]);
  const tablePrefs = useTablePrefs("notifications", toolbarColumns);
  const [bucket, setBucket] = useState<NotificationListBucket>("all");
  const [category, setCategory] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [, startExport] = useTransition();
  const listFilters = useMemo(() => {
    const filters: NotificationListFilters = {};
    if (bucket !== "all") filters.bucket = bucket;
    if (category !== "all") filters.category = category;
    if (fromDate) filters.fromDate = fromDate;
    if (toDate) filters.toDate = toDate;
    return filters;
  }, [bucket, category, fromDate, toDate]);
  const { data: kpis, isLoading: kpisLoading, refetch: refetchKpis } = useNotificationDashboard();
  const {
    data: campaignPages,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    refetch,
  } = useInfiniteNotificationCampaigns(listFilters);

  const campaigns = useMemo(
    () => campaignPages?.pages.flatMap((page) => page.rows) ?? [],
    [campaignPages],
  );
  const filteredCampaigns = useMemo(
    () =>
      campaigns.filter((row) =>
        fieldSearchMatch(row, tablePrefs.appliedQuery, {
          name: (item) => item.title,
          body: (item) => item.body,
          status: (item) => item.status,
        }),
      ),
    [campaigns, tablePrefs.appliedQuery],
  );
  const groupedCampaigns = useMemo(
    () =>
      groupRows(
        filteredCampaigns,
        tablePrefs.groupBy,
        {
          status: (row) => row.status,
        },
        {},
        "—",
      ),
    [filteredCampaigns, tablePrefs.groupBy],
  );
  const listView = useGroupedListView(
    groupedCampaigns,
    tablePrefs.groupBy !== "none",
    `${tablePrefs.groupBy}\u0001${tablePrefs.appliedQuery}`,
  );
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);
  const totalCount = campaignPages?.pages[0]?.totalCount ?? campaigns.length;

  const tableColumns = tablePrefs.orderedColumns.filter((column) => tablePrefs.isVisible(column.id));
  const runExport = () => {
    startExport(async () => {
      const result = await exportNotificationCampaignsCsv({
        ...listFilters,
        search: tablePrefs.appliedQuery,
      });
      if ("error" in result) {
        toast.error(t(`errors.${result.error}`));
        return;
      }
      downloadCsv(`notifications-${bucket}.csv`, result.csv);
    });
  };
  const toolbar = (
    <TableToolbar
      prefs={tablePrefs}
      entity={t("title")}
      columns={toolbarColumns}
      rowKind="dynamic"
      entityList
      filteredCount={filteredCampaigns.length}
      totalCount={totalCount}
      onExport={canExport ? runExport : undefined}
      onAdd={canManage ? () => router.push(`/${locale}/notifications/new`) : undefined}
      addLabel={t("createNotification")}
    />
  );

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <ClearAllModuleButton entity="notifications" />
          </div>
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
            value: kpisLoading ? "…" : formatPct(kpis?.deliveryRate ?? 0),
          },
          {
            label: t("kpiOpenRate"),
            value: kpisLoading ? "…" : formatPct(kpis?.openRate ?? 0),
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
        toolbar={
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {NOTIFICATION_LIST_BUCKETS.map((id) => {
                const chip = bucketChip(id);
                return (
                  <ToggleChip
                    key={id}
                    size="md"
                    className="h-9"
                    selected={bucket === id}
                    icon={chip.icon}
                    onClick={() => setBucket(id)}
                  >
                    {t(chip.label)}
                  </ToggleChip>
                );
              })}
              <Select
                items={[
                  { value: "all", label: t("filterAllCategories") },
                  ...NOTIFICATION_CATEGORIES.map((value) => ({
                    value,
                    label: value.replaceAll("_", " "),
                  })),
                ]}
                value={category}
                onValueChange={(value) => setCategory(value || "all")}
              >
                <SelectTrigger className="h-9 w-[180px]">
                  <SelectValue placeholder={t("filterCategory")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filterAllCategories")}</SelectItem>
                  {NOTIFICATION_CATEGORIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value.replaceAll("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input
                type="date"
                aria-label={t("filterFrom")}
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
              />
              <input
                type="date"
                aria-label={t("filterTo")}
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
              />
            </div>
          </div>
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
              {tablePrefs.view === "grid" ? (
                <>
                  {toolbar}
                  <TableGridCards
                    rows={filteredCampaigns.map((row) => ({
                      id: row.id,
                      name: row.title,
                      status: { status: "neutral", label: row.status.replaceAll("_", " ") },
                      fields: [
                        { label: t("colCategory"), value: row.category.replaceAll("_", " ") },
                        { label: t("colAudience"), value: String(row.recipient_count || row.estimated_audience_count || 0) },
                      ],
                      onOpen: () => router.push(`/${locale}/notifications/${row.id}`),
                    }))}
                  />
                </>
              ) : null}
              {tablePrefs.view === "list" ? (
              <FlatListPager pager={listView.flatPager} onStep={listView.stepFlat} />
              ) : null}
              {tablePrefs.view === "list" ? (
              <AppDataTable toolbar={toolbar} columns={tableColumns}>
                {listView.sections.flatMap((section) => [
                  section.showHeader ? (
                    <GroupTableHeaderRow
                      key={`g-${section.key}`}
                      colSpan={tableColumns.length}
                      label={section.label}
                      total={section.total}
                      open={section.open}
                      page={section.page}
                      showPager={section.showPager}
                      onToggle={() => listView.toggle(section.key)}
                      onStep={(dir) => listView.step(section.key, dir)}
                    />
                  ) : null,
                  ...section.visibleRows.map((row) => (
                  <AppDataTableRow
                    key={row.id}
                    onClick={() => router.push(`/${locale}/notifications/${row.id}`)}
                  >
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link
                          href={`/${locale}/notifications/${row.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          <TableNameCell name={row.title} />
                        </Link>
                        {row.screenshot_restricted ? (
                          <span className="inline-flex items-center gap-0.5 rounded-md border border-amber-200 bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                            <ShieldOff className="size-3" aria-hidden />
                            {t("screenshotRestrictedBadge")}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-1">{row.body}</p>
                    </TableCell>
                    <TableCell className="capitalize">{row.category.replace("_", " ")}</TableCell>
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <CampaignAudienceButton
                        campaignId={row.id}
                        count={row.recipient_count || row.estimated_audience_count || 0}
                        title={row.title}
                        body={row.body}
                      />
                    </TableCell>
                    <TableCell>
                      <StatusPill variant={resolveStatusVariant(row.status)}>
                        {row.status.replace("_", " ")}
                      </StatusPill>
                    </TableCell>
                    <TableCell>{formatDateTime(row.sent_at ?? row.scheduled_for)}</TableCell>
                    <TableCell onClick={(event) => event.stopPropagation()}>
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
                  )),
                ])}
              </AppDataTable>
              ) : null}
              <div className="flex flex-col items-center gap-2 border-t border-border py-4">
                <p className="text-xs text-muted-foreground">
                  {t("showingCount", { visible: filteredCampaigns.length, total: totalCount })}
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
