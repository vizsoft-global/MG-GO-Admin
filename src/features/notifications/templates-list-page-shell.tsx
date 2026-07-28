"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { AppListCard } from "@/components/app/app-list-card";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { AppEmptyState } from "@/components/app/app-empty-state";
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
import { useNotificationTemplates } from "./use-notifications";

export function TemplatesListPageShell() {
  const t = useTranslations("pages.notifications");
  const locale = useLocale();
  const auth = useAuth();
  const canManage = auth.can("notifications.manage");
  const { data, isLoading } = useNotificationTemplates();

  return (
    <AppPage>
      <AppPageHeader
        title={t("navTemplates")}
        description={t("templatesSubtitle")}
        breadcrumbs={[
          { label: t("title"), href: `/${locale}/notifications` },
          { label: t("navTemplates") },
        ]}
        actions={
          canManage ? (
            <Button
              render={<Link href={`/${locale}/notifications/templates/new`} />}
              className="h-9 cursor-pointer"
            >
              <Plus className="size-4" />
              {t("templateCreate")}
            </Button>
          ) : null
        }
      />
      <NotificationsTabBar />
      <AppListCard title={t("navTemplates")}>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : !data?.length ? (
            <AppEmptyState title={t("templatesEmpty")} description={t("templatesEmptyHint")} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("fieldName")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("fieldCategory")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("fieldPriority")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("fieldTitle")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((tpl) => (
                  <TableRow key={tpl.id} className="cursor-pointer hover:bg-muted/30">
                    <TableCell>
                      <Link
                        href={`/${locale}/notifications/templates/${tpl.id}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {tpl.name}
                      </Link>
                    </TableCell>
                    <TableCell className="capitalize">{t(`categories.${tpl.category}`)}</TableCell>
                    <TableCell className="capitalize">{t(`priorities.${tpl.priority}`)}</TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">
                      {tpl.title_template}
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
