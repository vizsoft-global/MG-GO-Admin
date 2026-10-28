"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { AppListCard } from "@/components/app/app-list-card";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import {
  EmptyCell,
  TableGridCards,
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NotificationsTabBar } from "@/features/notifications/notifications-tab-bar";
import { CampaignAudienceButton } from "@/features/notifications/notification-audience-dialog";
import { useNotificationCampaigns } from "@/features/notifications/use-notifications";

export function NotificationHistoryPageShell() {
  const t = useTranslations("pages.notifications");
  const locale = useLocale();
  const router = useRouter();
  const { data, isLoading } = useNotificationCampaigns({});
  const columns = useMemo((): TableToolbarColumn[] => [
    { id: "title", label: t("colTitle"), locked: true },
    { id: "status", label: t("colStatus") },
    { id: "audience", label: t("colAudience") },
    { id: "sent", label: t("colSent") },
  ], [t]);
  const prefs = useTablePrefs("notification-history", columns);
  const shown = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));
  const needle = prefs.appliedQuery.trim().toLowerCase();
  const rows = (data ?? []).filter((row) =>
    !needle || `${row.title} ${row.status} ${row.body ?? ""}`.toLowerCase().includes(needle),
  );

  const toolbar = (
    <TableToolbar
      prefs={prefs}
      entity={t("navHistory")}
      columns={columns}
      rowKind="dynamic"
      entityList
      filteredCount={rows.length}
      totalCount={(data ?? []).length}
    />
  );

  return (
    <AppPage>
      <AppPageHeader
        title={t("navHistory")}
        description={t("historySubtitle")}
        breadcrumbs={[
          { label: t("title"), href: "/notifications" },
          { label: t("navHistory") },
        ]}
      />
      <NotificationsTabBar />
      <AppListCard title={t("navHistory")}>
        <CardContent className="p-0">
          {toolbar}
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : prefs.view === "grid" ? (
            <TableGridCards
              rows={rows.map((row) => ({
                id: row.id,
                name: row.title,
                status: { status: "neutral", label: row.status.replaceAll("_", " ") },
                fields: [
                  { label: t("colAudience"), value: String(row.recipient_count || row.estimated_audience_count || 0) },
                  { label: t("colSent"), value: row.sent_at ?? row.scheduled_for ?? "—" },
                ],
                onOpen: () => router.push(`/${locale}/notifications/${row.id}`),
              }))}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {shown.map((column) => (
                    <TableHead key={column.id} className={TABLE_HEAD_CLASS}>{column.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    {shown.map((column) => {
                      if (column.id === "title") {
                        return (
                          <TableCell key={column.id}>
                            <Link
                              href={`/${locale}/notifications/${row.id}`}
                              className="font-medium text-primary hover:underline"
                            >
                              <TableNameCell name={row.title} />
                            </Link>
                          </TableCell>
                        );
                      }
                      if (column.id === "status") {
                        return <TableCell key={column.id} className="capitalize">{row.status.replace("_", " ")}</TableCell>;
                      }
                      if (column.id === "audience") {
                        return (
                          <TableCell key={column.id}>
                            <CampaignAudienceButton
                              campaignId={row.id}
                              count={row.recipient_count || row.estimated_audience_count || 0}
                              title={row.title}
                              body={row.body}
                            />
                          </TableCell>
                        );
                      }
                      return (
                        <TableCell key={column.id}>
                          {row.sent_at ?? row.scheduled_for ? (row.sent_at ?? row.scheduled_for) : <EmptyCell />}
                        </TableCell>
                      );
                    })}
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
