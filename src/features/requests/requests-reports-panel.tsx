"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { queryKeys } from "@/lib/query/query-keys";
import { fetchAdminRequestsList } from "./requests-actions";
import { datePresetToBounds } from "./date-presets";

const REQUEST_TYPES = [
  "leave",
  "sick_leave",
  "loan",
  "asset",
  "fuel",
  "document",
  "complaint",
  "salary_justification",
] as const;

const REQUEST_STATUSES = [
  "pending",
  "submitted",
  "in_review",
  "needs_clarification",
  "approved",
  "rejected",
  "solved",
  "overdue",
] as const;

function monthLabel(): string {
  return new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function RequestsReportsPanel() {
  const t = useTranslations("pages.requests.settings.reports");
  const tRoot = useTranslations("pages.requests");
  const tTypes = useTranslations("pages.requests.types");
  const tStatus = useTranslations("pages.requests.status");

  const { from, to } = useMemo(() => datePresetToBounds("this_month"), []);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.requests.list({ reports: true, from, to }),
    queryFn: () =>
      fetchAdminRequestsList({ datePreset: "this_month", limit: 1000, offset: 0 }),
  });

  const rows = data?.rows ?? [];
  const kpi = data?.kpi;

  const byType = useMemo(() => {
    const map = Object.fromEntries(REQUEST_TYPES.map((k) => [k, 0])) as Record<string, number>;
    for (const row of rows) map[row.request_type] = (map[row.request_type] ?? 0) + 1;
    return map;
  }, [rows]);

  const byStatus = useMemo(() => {
    const map = Object.fromEntries(REQUEST_STATUSES.map((k) => [k, 0])) as Record<string, number>;
    for (const row of rows) map[row.status] = (map[row.status] ?? 0) + 1;
    return map;
  }, [rows]);

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle", { month: monthLabel() })}
        breadcrumbs={[
          { label: t("hub"), href: "/requests/settings" },
          { label: t("title") },
        ]}
      />

      {isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <KpiGrid
            items={[
              { label: tRoot("kpi.total"), value: String(rows.length) },
              { label: tRoot("kpi.pending"), value: String(kpi?.pending ?? 0), accent: "warning" },
              { label: tRoot("kpi.overdue"), value: String(kpi?.overdue ?? 0), accent: "danger" },
            ]}
          />

          <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
            <AppListCard className="h-full p-0">
              <h3 className="border-b border-border p-3 text-sm font-semibold">{t("byType")}</h3>
              <AppDataTable
                columns={[
                  { id: "type", label: t("colType") },
                  { id: "count", label: t("colCount") },
                  { id: "share", label: t("colShare") },
                ]}
              >
                {rows.length === 0 ? (
                  <AppDataTableEmpty>{t("emptyTitle")}</AppDataTableEmpty>
                ) : (
                  REQUEST_TYPES.map((type) => {
                    const count = byType[type] ?? 0;
                    const share = rows.length > 0 ? Math.round((count / rows.length) * 100) : 0;
                    return (
                      <AppDataTableRow key={type}>
                        <TableCell className="text-sm">{tTypes(type)}</TableCell>
                        <TableCell className="tabular-nums">{count}</TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">{share}%</TableCell>
                      </AppDataTableRow>
                    );
                  })
                )}
              </AppDataTable>
            </AppListCard>

            <AppListCard className="h-full p-0">
              <h3 className="border-b border-border p-3 text-sm font-semibold">{t("byStatus")}</h3>
              <AppDataTable
                columns={[
                  { id: "status", label: tRoot("colStatus") },
                  { id: "count", label: t("colCount") },
                  { id: "share", label: t("colShare") },
                ]}
              >
                {rows.length === 0 ? (
                  <AppDataTableEmpty>{t("emptyTitle")}</AppDataTableEmpty>
                ) : (
                  REQUEST_STATUSES.map((status) => {
                    const count = byStatus[status] ?? 0;
                    const share = rows.length > 0 ? Math.round((count / rows.length) * 100) : 0;
                    return (
                      <AppDataTableRow key={status}>
                        <TableCell className="text-sm">{tStatus(status)}</TableCell>
                        <TableCell className="tabular-nums">{count}</TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">{share}%</TableCell>
                      </AppDataTableRow>
                    );
                  })
                )}
              </AppDataTable>
            </AppListCard>
          </div>
        </>
      )}
    </AppPage>
  );
}
