"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
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
import { StatusPill } from "@/components/dashboard/status-pill";
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
  const router = useRouter();
  const auth = useAuth();
  const canManage = auth.can("notifications.manage");
  const { data, isLoading } = useNotificationAutomations();
  const columns = useMemo((): TableToolbarColumn[] => [
    { id: "name", label: t("fieldName"), locked: true },
    { id: "trigger", label: t("fieldTrigger") },
    { id: "status", label: t("colStatus"), categorical: true },
    { id: "category", label: t("fieldCategory"), categorical: true },
    { id: "last", label: t("automationLastRun") },
  ], [t]);
  const prefs = useTablePrefs("notification-automations", columns);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const shown = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));
  const needle = prefs.appliedQuery.trim().toLowerCase();
  const rows = (data ?? []).filter((row) =>
    !needle || `${row.name} ${row.trigger_type} ${row.status} ${row.category}`.toLowerCase().includes(needle),
  );
  const grouped = prefs.groupBy === "none"
    ? [{ key: "all", label: "", rows }]
    : Object.entries(rows.reduce<Record<string, typeof rows>>((buckets, row) => {
        const key = prefs.groupBy === "status" ? row.status : row.category;
        buckets[key] = [...(buckets[key] ?? []), row];
        return buckets;
      }, {})).map(([key, groupRows]) => ({
        key,
        label: prefs.groupBy === "status" ? t(`automationStatuses.${key}`) : t(`categories.${key}`),
        rows: groupRows,
      }));
  const toolbar = (
    <TableToolbar
      prefs={prefs}
      entity={t("navAutomations")}
      columns={columns}
      rowKind="dynamic"
      entityList
      filteredCount={rows.length}
      totalCount={(data ?? []).length}
      onAdd={canManage ? () => router.push(`/${locale}/notifications/automations/new`) : undefined}
      addLabel={t("automationCreate")}
    />
  );

  return (
    <AppPage>
      <AppPageHeader
        title={t("navAutomations")}
        description={t("automationsSubtitle")}
        breadcrumbs={[
          { label: t("title"), href: "/notifications" },
          { label: t("navAutomations") },
        ]}
      />
      <NotificationsTabBar />
      <AppListCard title={t("navAutomations")}>
        <CardContent className="p-0">
          {toolbar}
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : !data?.length ? (
            <AppEmptyState title={t("automationsEmpty")} description={t("automationsEmptyHint")} />
          ) : prefs.view === "grid" ? (
            <TableGridCards
              rows={rows.map((row) => ({
                id: row.id,
                name: row.name,
                status: { status: "neutral", label: t(`automationStatuses.${row.status}`) },
                fields: [
                  { label: t("fieldTrigger"), value: t(`automationTriggers.${row.trigger_type}`) },
                  { label: t("fieldCategory"), value: t(`categories.${row.category}`) },
                ],
                onOpen: () => router.push(`/${locale}/notifications/automations/${row.id}`),
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
                {grouped.flatMap((group) => {
                  const open = prefs.groupBy === "none" || openGroups.has(group.key);
                  const header = prefs.groupBy === "none" ? null : (
                    <TableRow key={`g-${group.key}`} className="hover:bg-transparent">
                      <TableCell colSpan={shown.length}>
                        <button
                          type="button"
                          className="cursor-pointer text-sm font-semibold"
                          onClick={() => setOpenGroups((current) => {
                            const next = new Set(current);
                            if (next.has(group.key)) next.delete(group.key);
                            else next.add(group.key);
                            return next;
                          })}
                        >
                          {group.label} {group.rows.length}
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                  if (!open) return header ? [header] : [];
                  return [
                    header,
                    ...group.rows.map((row) => (
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/30">
                        {shown.map((column) => {
                          if (column.id === "name") {
                            return (
                              <TableCell key={column.id}>
                                <Link href={`/${locale}/notifications/automations/${row.id}`} className="font-medium text-foreground hover:underline">
                                  <TableNameCell name={row.name} />
                                </Link>
                              </TableCell>
                            );
                          }
                          if (column.id === "trigger") {
                            return <TableCell key={column.id} className="capitalize">{t(`automationTriggers.${row.trigger_type}`)}</TableCell>;
                          }
                          if (column.id === "status") {
                            return (
                              <TableCell key={column.id}>
                                <StatusPill variant={resolveStatusVariant(row.status)}>
                                  {t(`automationStatuses.${row.status}`)}
                                </StatusPill>
                              </TableCell>
                            );
                          }
                          if (column.id === "category") {
                            return <TableCell key={column.id} className="capitalize">{t(`categories.${row.category}`)}</TableCell>;
                          }
                          return (
                            <TableCell key={column.id} className="text-muted-foreground">
                              {row.last_run_at
                                ? new Intl.DateTimeFormat(locale, {
                                    dateStyle: "medium",
                                    timeStyle: "short",
                                    timeZone: "Asia/Kuwait",
                                  }).format(new Date(row.last_run_at))
                                : <EmptyCell />}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    )),
                  ];
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </AppListCard>
    </AppPage>
  );
}
