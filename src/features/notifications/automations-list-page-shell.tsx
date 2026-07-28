"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { AppListCard } from "@/components/app/app-list-card";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/auth-context";
import { NotificationsTabBar } from "./notifications-tab-bar";
import { resolveStatusVariant } from "@/lib/ui/resolve-status-variant";
import { useNotificationAutomations } from "./use-notifications";

export function AutomationsListPageShell() {
  const t = useTranslations("pages.notifications");
  const locale = useLocale();
  const auth = useAuth();
  const canManage = auth.can("notifications.manage");
  const { data, isLoading } = useNotificationAutomations();

  return (
    <AppPage>
      <AppPageHeader
        title={t("navAutomations")}
        description={t("automationsSubtitle")}
        breadcrumbs={[
          { label: t("title"), href: `/${locale}/notifications` },
          { label: t("navAutomations") },
        ]}
        actions={
          canManage ? (
            <Button
              render={<Link href={`/${locale}/notifications/automations/new`} />}
              className="h-9 cursor-pointer"
            >
              <Plus className="size-4" />
              {t("automationCreate")}
            </Button>
          ) : null
        }
      />
      <NotificationsTabBar />
      <AppListCard title={t("navAutomations")}>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : !data?.length ? (
            <AppEmptyState title={t("automationsEmpty")} description={t("automationsEmptyHint")} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("fieldName")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("fieldTrigger")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("fieldCategory")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("automationLastRun")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow key={row.id} className="cursor-pointer hover:bg-muted/30">
                    <TableCell>
                      <Link
                        href={`/${locale}/notifications/automations/${row.id}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {row.name}
                      </Link>
                    </TableCell>
                    <TableCell className="capitalize">
                      {t(`automationTriggers.${row.trigger_type}`)}
                    </TableCell>
                    <TableCell>
                      <StatusPill variant={resolveStatusVariant(row.status)}>
                        {t(`automationStatuses.${row.status}`)}
                      </StatusPill>
                    </TableCell>
                    <TableCell className="capitalize">{t(`categories.${row.category}`)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.last_run_at
                        ? new Intl.DateTimeFormat(locale, {
                            dateStyle: "medium",
                            timeStyle: "short",
                            timeZone: "Asia/Kuwait",
                          }).format(new Date(row.last_run_at))
                        : "—"}
                    </TableCell>
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
