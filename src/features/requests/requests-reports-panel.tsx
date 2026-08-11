"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Clock, Download, FileText, Loader2, Signature } from "lucide-react";
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
import { useEsignStatusCounts } from "@/features/esign/use-esign";
import { queryKeys } from "@/lib/query/query-keys";
import { selectOptions } from "@/lib/select-items";
import { fetchAdminRequestsList } from "./requests-actions";
import {
  fetchAppointmentStatusCounts,
  fetchRequestDepartmentReport,
} from "./requests-settings-actions";
import { datePresetToBounds } from "./date-presets";
import type { RequestDatePreset } from "./types";

const GROUP_BY_OPTIONS = ["department", "type", "status"] as const;

type GroupBy = (typeof GROUP_BY_OPTIONS)[number];

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

const WEEK_MS = 7 * 24 * 3600 * 1000;
const CHART_WEEKS = 12;

/** Trailing 12 ISO weeks of created volume — Figma "Requests over time". */
function weeklyVolume(rows: { created_at: string }[]): { label: string; count: number }[] {
  const now = Date.now();
  const buckets = Array.from({ length: CHART_WEEKS }, (_, i) => ({
    label: `W${i + 1}`,
    count: 0,
  }));
  for (const row of rows) {
    const created = Date.parse(row.created_at);
    if (Number.isNaN(created)) continue;
    const weeksAgo = Math.floor((now - created) / WEEK_MS);
    if (weeksAgo < 0 || weeksAgo >= CHART_WEEKS) continue;
    buckets[CHART_WEEKS - 1 - weeksAgo].count += 1;
  }
  return buckets;
}

export function RequestsReportsPanel() {
  const t = useTranslations("pages.requests.settings.reports");
  const tRoot = useTranslations("pages.requests");
  const tTypes = useTranslations("pages.requests.types");
  const tStatus = useTranslations("pages.requests.status");
  const [datePreset, setDatePreset] = useState<RequestDatePreset>("this_month");
  const [groupBy, setGroupBy] = useState<GroupBy>("department");

  const { from, to } = useMemo(() => datePresetToBounds(datePreset), [datePreset]);

  // Base UI Select shows the raw value in the trigger unless `items` supplies the label.
  const groupByItems = useMemo(
    () =>
      selectOptions(
        GROUP_BY_OPTIONS.map((option) => ({
          value: option,
          label: t("groupByValue", { value: t(`groupByOptions.${option}`) }),
        })),
      ),
    [t],
  );

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.requests.list({ reports: true, from, to }),
    queryFn: () => fetchAdminRequestsList({ datePreset, limit: 1000, offset: 0 }),
  });

  const rows = data?.rows ?? [];
  const kpi = data?.kpi;
  const { data: esignCounts } = useEsignStatusCounts();
  const { data: appointmentCounts } = useQuery({
    queryKey: ["requests", "reports", "appointment-status-counts"],
    queryFn: fetchAppointmentStatusCounts,
  });
  const { data: departmentReport } = useQuery({
    queryKey: ["requests", "reports", "departments", from, to],
    queryFn: () => fetchRequestDepartmentReport({ from, to }),
  });

  const departmentRows = useMemo(() => departmentReport?.rows ?? [], [departmentReport?.rows]);
  const maxStepSeconds = useMemo(
    () => departmentRows.reduce((max, row) => Math.max(max, row.avg_step_seconds ?? 0), 0),
    [departmentRows],
  );

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

  const volume = useMemo(() => weeklyVolume(rows), [rows]);
  const maxVolume = useMemo(
    () => volume.reduce((max, bucket) => Math.max(max, bucket.count), 0),
    [volume],
  );
  const pendingAck = useMemo(
    () => rows.filter((row) => row.awaiting_driver_ack).length,
    [rows],
  );

  const totalDelta = useMemo(() => {
    if (kpi?.prev_total == null) return null;
    return rows.length - kpi.prev_total;
  }, [kpi?.prev_total, rows.length]);

  const resolutionDelta = useMemo(() => {
    if (kpi?.avg_resolution_seconds == null || kpi?.prev_avg_resolution_seconds == null) {
      return null;
    }
    return (kpi.prev_avg_resolution_seconds - kpi.avg_resolution_seconds) / 86400;
  }, [kpi?.avg_resolution_seconds, kpi?.prev_avg_resolution_seconds]);

  const approvalRate = useMemo(() => {
    const decided = rows.filter((r) => r.status === "approved" || r.status === "rejected");
    if (decided.length === 0) return null;
    const approved = decided.filter((r) => r.status === "approved").length;
    return Math.round((approved / decided.length) * 100);
  }, [rows]);

  function exportCsv() {
    const csv = buildCsv(
      [
        "request_code",
        "type",
        "status",
        "department",
        "driver_name",
        "driver_code",
        "created_at",
      ],
      rows.map((r) => [
        r.request_code,
        r.request_type,
        r.status,
        r.department_label ?? "",
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
          { label: tRoot("title"), href: "/requests" },
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
            <Select
              value={groupBy}
              onValueChange={(v) => v && setGroupBy(v as GroupBy)}
              items={groupByItems}
            >
              <SelectTrigger className="h-9 w-[190px]" aria-label={t("groupBy")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROUP_BY_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {t(`groupByOptions.${option}`)}
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
              {
                label: t("kpiTotal"),
                value: String(rows.length),
                icon: FileText,
                caption:
                  totalDelta == null
                    ? undefined
                    : t("deltaVsPrev", {
                        delta: `${totalDelta >= 0 ? "+" : ""}${totalDelta}`,
                      }),
              },
              {
                label: t("kpiAvgResolution"),
                value: `${formatDays(kpi?.avg_resolution_seconds)}${t("days")}`,
                icon: Clock,
                accent: "primary",
                caption:
                  resolutionDelta == null
                    ? undefined
                    : resolutionDelta >= 0
                      ? t("deltaFaster", { days: resolutionDelta.toFixed(1) })
                      : t("deltaSlower", { days: Math.abs(resolutionDelta).toFixed(1) }),
              },
              {
                label: t("kpiApprovalRate"),
                value: approvalRate == null ? "—" : `${approvalRate}%`,
                icon: CheckCircle2,
                accent: "success",
              },
              {
                label: t("kpiPendingAck"),
                value: String(pendingAck),
                icon: Signature,
                accent: "warning",
                caption: t("kpiPendingAckCaption"),
              },
            ]}
          />

          <div className="grid gap-2 lg:grid-cols-3 lg:items-stretch">
            <AppListCard className="h-full space-y-3 p-4 lg:col-span-2">
              <div>
                <h3 className="text-sm font-semibold">{t("volumeTitle")}</h3>
                <p className="text-[11px] text-muted-foreground">{t("volumeSubtitle")}</p>
              </div>
              {maxVolume === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("emptyTitle")}</p>
              ) : (
                <div className="flex h-40 items-end gap-1.5">
                  {volume.map((bucket) => (
                    <div
                      key={bucket.label}
                      className="flex h-full flex-1 flex-col items-center justify-end gap-1"
                      title={t("volumeTooltip", { week: bucket.label, count: bucket.count })}
                    >
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {bucket.count > 0 ? bucket.count : ""}
                      </span>
                      <div
                        className="w-full rounded-t-sm bg-primary/25"
                        style={{
                          height: `${Math.max(2, Math.round((bucket.count / maxVolume) * 80))}%`,
                        }}
                      />
                      <span className="text-[10px] text-muted-foreground">{bucket.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </AppListCard>

            <AppListCard className="h-full space-y-2 p-4">
              <div>
                <h3 className="text-sm font-semibold">{t("stepTimeTitle")}</h3>
                <p className="text-[11px] text-muted-foreground">{t("stepTimeSubtitle")}</p>
              </div>
              {maxStepSeconds === 0 ? (
                <p className="py-6 text-center text-[11px] text-muted-foreground">
                  {t("stepTimeEmpty")}
                </p>
              ) : (
                <div className="space-y-2">
                  {departmentRows
                    .filter((row) => row.avg_step_seconds != null)
                    .map((row) => (
                      <div key={row.department_key} className="space-y-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-xs">{row.department_label}</span>
                          <span className="shrink-0 text-xs font-medium tabular-nums">
                            {formatDays(row.avg_step_seconds)}
                            {t("days")}
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-muted">
                          <div
                            className="h-1.5 rounded-full bg-primary"
                            style={{
                              width: `${Math.max(
                                4,
                                Math.round(((row.avg_step_seconds ?? 0) / maxStepSeconds) * 100),
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </AppListCard>
          </div>

          {groupBy === "department" ? (
            <AppListCard className="p-0">
              <div className="border-b border-border p-3">
                <h3 className="text-sm font-semibold">{t("byDepartment")}</h3>
                <p className="text-[11px] text-muted-foreground">{t("byDepartmentSubtitle")}</p>
              </div>
              <AppDataTable
                columns={[
                  { id: "department", label: t("colDepartment") },
                  { id: "requests", label: t("colRequests") },
                  { id: "approved", label: t("colApproved") },
                  { id: "rejected", label: t("colRejected") },
                  { id: "rate", label: t("colApprovalRate") },
                  { id: "avg", label: t("colAvgStepTime") },
                ]}
              >
                {departmentRows.length === 0 ? (
                  <AppDataTableEmpty>{t("departmentEmpty")}</AppDataTableEmpty>
                ) : (
                  departmentRows.map((row) => {
                    const decided = row.approved + row.rejected;
                    return (
                      <AppDataTableRow key={row.department_key}>
                        <TableCell className="text-sm">{row.department_label}</TableCell>
                        <TableCell className="tabular-nums">{row.requests}</TableCell>
                        <TableCell className="tabular-nums">{row.approved}</TableCell>
                        <TableCell className="tabular-nums">{row.rejected}</TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {decided === 0
                            ? "—"
                            : `${Math.round((row.approved / decided) * 100)}%`}
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {row.avg_step_seconds == null
                            ? "—"
                            : `${formatDays(row.avg_step_seconds)}${t("days")}`}
                        </TableCell>
                      </AppDataTableRow>
                    );
                  })
                )}
              </AppDataTable>
            </AppListCard>
          ) : groupBy === "type" ? (
            <AppListCard className="p-0">
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
          ) : (
            <AppListCard className="p-0">
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
          )}

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{t("signaturesSection")}</h3>
            <div className="grid gap-2 lg:grid-cols-3 lg:items-stretch">
              <AppListCard className="h-full space-y-2 p-4">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  {t("esignTitle")}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-lg font-semibold tabular-nums text-emerald-700">
                      {esignCounts?.signed ?? "—"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{t("esignSigned")}</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold tabular-nums text-warning">
                      {esignCounts?.pending ?? "—"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{t("esignPending")}</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold tabular-nums text-muted-foreground">
                      {esignCounts?.expired ?? "—"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{t("esignExpired")}</p>
                  </div>
                </div>
              </AppListCard>

              <AppListCard className="h-full space-y-2 p-4">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  {t("ackTitle")}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-lg font-semibold tabular-nums">{pendingAck}</p>
                    <p className="text-[10px] text-muted-foreground">{t("ackPending")}</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold tabular-nums text-muted-foreground">—</p>
                    <p className="text-[10px] text-muted-foreground">{t("ackRate")}</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold tabular-nums text-muted-foreground">—</p>
                    <p className="text-[10px] text-muted-foreground">{t("ackAvgTime")}</p>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">{t("ackGapNote")}</p>
              </AppListCard>

              <AppListCard className="h-full space-y-2 p-4">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <span className="h-2 w-2 rounded-full bg-sky-500" />
                  {t("appointmentsTitle")}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-lg font-semibold tabular-nums text-emerald-700">
                      {appointmentCounts?.accepted ?? "—"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{t("appointmentsAccepted")}</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold tabular-nums text-warning">
                      {appointmentCounts?.pending ?? "—"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{t("appointmentsPending")}</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold tabular-nums text-destructive">
                      {appointmentCounts?.rejected ?? "—"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{t("appointmentsRejected")}</p>
                  </div>
                </div>
              </AppListCard>
            </div>
          </div>
        </>
      )}
    </AppPage>
  );
}
