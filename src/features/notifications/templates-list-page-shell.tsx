"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, ShieldOff } from "lucide-react";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import {
  EmptyCell,
  TableGridCards,
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { AppListCard } from "@/components/app/app-list-card";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { AppEmptyState } from "@/components/app/app-empty-state";
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
  const router = useRouter();
  const auth = useAuth();
  const canManage = auth.can("notifications.manage");
  const { data, isLoading } = useNotificationTemplates();
  const columns = useMemo((): TableToolbarColumn[] => [
    { id: "name", label: t("fieldName"), locked: true },
    { id: "category", label: t("fieldCategory") },
    { id: "priority", label: t("fieldPriority") },
    { id: "title", label: t("fieldTitle") },
  ], [t]);
  const prefs = useTablePrefs("notification-templates", columns);
  const shown = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));
  const needle = prefs.appliedQuery.trim().toLowerCase();
  const rows = (data ?? []).filter((tpl) =>
    !needle || `${tpl.name} ${tpl.category} ${tpl.title_template}`.toLowerCase().includes(needle),
  );
  const toolbar = (
    <TableToolbar
      prefs={prefs}
      entity={t("navTemplates")}
      columns={columns}
      rowKind="dynamic"
      entityList
      filteredCount={rows.length}
      totalCount={(data ?? []).length}
      onAdd={canManage ? () => router.push(`/${locale}/notifications/templates/new`) : undefined}
      addLabel={t("templateCreate")}
    />
  );

  return (
    <AppPage>
      <AppPageHeader
        title={t("navTemplates")}
        description={t("templatesSubtitle")}
        breadcrumbs={[
          { label: t("title"), href: "/notifications" },
          { label: t("navTemplates") },
        ]}
      />
      <NotificationsTabBar />
      <AppListCard title={t("navTemplates")}>
        <CardContent className="p-0">
          {toolbar}
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : !data?.length ? (
            <AppEmptyState title={t("templatesEmpty")} description={t("templatesEmptyHint")} />
          ) : prefs.view === "grid" ? (
            <TableGridCards
              rows={rows.map((tpl) => ({
                id: tpl.id,
                name: tpl.name,
                fields: [
                  { label: t("fieldCategory"), value: t(`categories.${tpl.category}`) },
                  { label: t("fieldTitle"), value: tpl.title_template || "—" },
                ],
                onOpen: () => router.push(`/${locale}/notifications/templates/${tpl.id}`),
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
                {rows.map((tpl) => (
                  <TableRow key={tpl.id} className="cursor-pointer hover:bg-muted/30">
                    {shown.map((column) => {
                      if (column.id === "name") {
                        return (
                          <TableCell key={column.id}>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Link
                                href={`/${locale}/notifications/templates/${tpl.id}`}
                                className="font-medium text-foreground hover:underline"
                              >
                                <TableNameCell name={tpl.name} />
                              </Link>
                              {tpl.screenshot_restricted ? (
                                <span className="inline-flex items-center gap-0.5 rounded-md border border-amber-200 bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                                  <ShieldOff className="size-3" aria-hidden />
                                  {t("screenshotRestrictedBadge")}
                                </span>
                              ) : null}
                            </div>
                          </TableCell>
                        );
                      }
                      if (column.id === "category") {
                        return <TableCell key={column.id} className="capitalize">{t(`categories.${tpl.category}`)}</TableCell>;
                      }
                      if (column.id === "priority") {
                        return <TableCell key={column.id} className="capitalize">{t(`priorities.${tpl.priority}`)}</TableCell>;
                      }
                      return (
                        <TableCell key={column.id} className="max-w-xs truncate text-muted-foreground">
                          {tpl.title_template ? tpl.title_template : <EmptyCell />}
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
