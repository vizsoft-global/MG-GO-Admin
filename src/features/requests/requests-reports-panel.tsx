"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Clock, Download, FileText, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildCsv, downloadCsv } from "@/features/driver-tracking/csv-export";
import { queryKeys } from "@/lib/query/query-keys";
import { fetchAdminRequestsList } from "./requests-actions";
import { datePresetToBounds } from "./date-presets";
import type { RequestDatePreset } from "./types";

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

const DATE_PRESETS: RequestDatePreset[] = [
  "today",
  "tomorrow",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_year",
  "last_year",
  "all",
];

function formatDays(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  return `${(seconds / 86400).toFixed(1)}`;
}

export function RequestsReportsPanel() {
  const t = useTranslations("pages.requests.settings.reports");
  const tRoot = useTranslations("pages.requests");
  const tTypes = useTranslations("pages.requests.types");
  const tStatus = useTranslations("pages.requests.status");
  const [datePreset, setDatePreset] = useState<RequestDatePreset>("this_month");

  const { from, to } = useMemo(() => datePresetToBounds(datePreset), [datePreset]);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.requests.list({ reports: true, from, to }),
    queryFn: () => fetchAdminRequestsList({ datePreset, limit: 1000, offset: 0 }),
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

  const approvalRate = useMemo(() => {
    const decided = rows.filter((r) => r.status === "approved" || r.status === "rejected");
    if (decided.length === 0) return null;
    const approved = decided.filter((r) => r.status === "approved").length;
    return Math.round((approved / decided.length) * 100);
  }, [rows]);

  function exportCsv() {
    const csv = buildCsv(
      ["request_code", "type", "status", "driver_name", "driver_code", "created_at"],
      rows.map((r) => [
        r.request_code,
        r.request_type,
        r.status,
        r.driver_name ?? "",
        r.driver_code ?? "",
        r.created_at,
      ]),
    );
    downloadCsv(`rcm-requests-${datePreset}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: t("hub"), href: "/requests/settings" },
          { label: t("title") },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={datePreset} onValueChange={(v) => v && setDatePreset(v as RequestDatePreset)}>
              <SelectTrigger className="h-9 w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_PRESETS.map((preset) => (
                  <SelectItem key={preset} value={preset}>
                    {tRoot(`datePresets.${preset}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9"
              disabled={rows.length === 0}
              onClick={exportCsv}
            >
              <Download className="me-1.5 h-3.5 w-3.5" />
              {t("export")}
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <KpiGrid
            items={[
              { label: t("kpiTotal"), value: String(rows.length), icon: FileText },
              {
                label: t("kpiAvgResolution"),
                value: `${formatDays(kpi?.avg_resolution_seconds)}${t("days")}`,
                icon: Clock,
                accent: "primary",
              },
              {
                label: t("kpiApprovalRate"),
                value: approvalRate == null ? "—" : `${approvalRate}%`,
                icon: CheckCircle2,
                accent: "success",
              },
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
