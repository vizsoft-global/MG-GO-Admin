"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { AppListCard } from "@/components/app/app-list-card";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
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
import { useNotificationCampaigns } from "@/features/notifications/use-notifications";

export function NotificationHistoryPageShell() {
  const t = useTranslations("pages.notifications");
  const locale = useLocale();
  const { data, isLoading } = useNotificationCampaigns({});

  return (
    <AppPage>
      <AppPageHeader
        title={t("navHistory")}
        description={t("historySubtitle")}
        breadcrumbs={[
          { label: t("title"), href: `/${locale}/notifications` },
          { label: t("navHistory") },
        ]}
      />
      <NotificationsTabBar />
      <AppListCard title={t("navHistory")}>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colTitle")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colAudience")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colSent")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link
                        href={`/${locale}/notifications/${row.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {row.title}
                      </Link>
                    </TableCell>
                    <TableCell className="capitalize">{row.status.replace("_", " ")}</TableCell>
                    <TableCell>{row.recipient_count || row.estimated_audience_count}</TableCell>
                    <TableCell>{row.sent_at ?? row.scheduled_for ?? "—"}</TableCell>
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
