"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Clock, FileText, Loader2, Signature } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { StatusBadge, type FrameStatus } from "@/components/app/status-badge";
import { EmptyCell, TableNameCell, TableToolbar, useTablePrefs, type TableToolbarColumn } from "@/components/app/table-toolbar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildCsv, downloadCsv } from "@/features/driver-tracking/csv-export";
import { useEsignStatusCounts } from "@/features/esign/use-esign";
import { formatPct } from "@/lib/format/percent";
import { queryKeys } from "@/lib/query/query-keys";
import { selectOptions, selectOptionsFrom } from "@/lib/select-items";
import { fetchAdminRequestsList, fetchAdminRequestsTrend } from "./requests-actions";
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

const CHART_WEEKS = 12;
const EXPORT_ROW_CAP = 1000;

function reportFrameStatus(status: string): FrameStatus | null {
  switch (status) {
    case "working":
    case "leave":
    case "sick":
    case "pending":
    case "absent":
    case "overdue":
    case "neutral":
    case "accident":
    case "other":
      return status;
    default:
      return null;
  }
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
    queryFn: () => fetchAdminRequestsList({ datePreset, limit: EXPORT_ROW_CAP, offset: 0 }),
  });

  /**
   * Every figure on this page comes from the trend RPC, not from the capped row
   * array beside it. The list read above exists only to feed the CSV export, so
   * a window with more than `EXPORT_ROW_CAP` requests can shorten the sheet
   * without moving a single number on the screen.
   */
  const { data: trend } = useQuery({
    queryKey: queryKeys.requests.trend({ from, to, weeks: CHART_WEEKS }),
    queryFn: () => fetchAdminRequestsTrend({ datePreset, weeks: CHART_WEEKS }),
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
  const deptColumns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "department", label: t("colDepartment"), locked: true },
      { id: "requests", label: t("colRequests") },
      { id: "approved", label: t("colApproved") },
      { id: "rejected", label: t("colRejected") },
      { id: "rate", label: t("colApprovalRate") },
      { id: "avg", label: t("colAvgStepTime") },
    ],
    [t],
  );
  const typeColumns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "type", label: t("colType"), locked: true },
      { id: "count", label: t("colCount") },
      { id: "share", label: t("colShare") },
    ],
    [t],
  );
  const statusColumns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "status", label: tRoot("colStatus"), locked: true },
      { id: "count", label: t("colCount") },
      { id: "share", label: t("colShare") },
    ],
    [t, tRoot],
  );
  const deptPrefs = useTablePrefs("requests.reports.department", deptColumns);
  const typePrefs = useTablePrefs("requests.reports.type", typeColumns);
  const statusPrefs = useTablePrefs("requests.reports.status", statusColumns);
  const deptShown = deptPrefs.orderedColumns.filter((column) => deptPrefs.isVisible(column.id));
  const typeShown = typePrefs.orderedColumns.filter((column) => typePrefs.isVisible(column.id));
  const statusShown = statusPrefs.orderedColumns.filter((column) => statusPrefs.isVisible(column.id));
  const deptFiltered = useMemo(() => {
    const query = deptPrefs.appliedQuery.trim().toLowerCase();
    if (!query) return departmentRows;
    return departmentRows.filter((row) =>
      (row.department_label ?? "").toLowerCase().includes(query),
    );
  }, [departmentRows, deptPrefs.appliedQuery]);
  const maxStepSeconds = useMemo(
    () => departmentRows.reduce((max, row) => Math.max(max, row.avg_step_seconds ?? 0), 0),
    [departmentRows],
  );

  const byType = useMemo(() => {
    const map = Object.fromEntries(REQUEST_TYPES.map((k) => [k, 0])) as Record<string, number>;
    for (const [key, value] of Object.entries(trend?.byType ?? {})) {
      map[key] = value;
    }
    return map;
  }, [trend?.byType]);

  const byStatus = useMemo(() => {
    const map = Object.fromEntries(REQUEST_STATUSES.map((k) => [k, 0])) as Record<string, number>;
    for (const [key, value] of Object.entries(trend?.byStatus ?? {})) {
      map[key] = value;
    }
    return map;
  }, [trend?.byStatus]);

  const volume = useMemo(() => trend?.volume ?? [], [trend?.volume]);
  const maxVolume = useMemo(
    () => volume.reduce((max, bucket) => Math.max(max, bucket.count), 0),
    [volume],
  );
  const totalCount = trend?.total ?? 0;
  const pendingAck = trend?.pendingAck ?? 0;

  const totalDelta = useMemo(() => {
    if (kpi?.prev_total == null || trend == null) return null;
    return trend.total - kpi.prev_total;
  }, [kpi?.prev_total, trend]);

  const resolutionDelta = useMemo(() => {
    if (kpi?.avg_resolution_seconds == null || kpi?.prev_avg_resolution_seconds == null) {
      return null;
    }
    return (kpi.prev_avg_resolution_seconds - kpi.avg_resolution_seconds) / 86400;
  }, [kpi?.avg_resolution_seconds, kpi?.prev_avg_resolution_seconds]);

  const approvalRate = useMemo(() => {
    const approved = trend?.approved ?? 0;
    const rejected = trend?.rejected ?? 0;
    const decided = approved + rejected;
    if (decided === 0) return null;
    return Math.round((approved / decided) * 100);
  }, [trend?.approved, trend?.rejected]);

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
    <AppPage className="space-y-3">
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: tRoot("title"), href: "/requests" },
          { label: t("title") },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={datePreset}
              onValueChange={(v) => v && setDatePreset(v as RequestDatePreset)}
              items={selectOptionsFrom(
                DATE_PRESETS,
                (preset) => preset,
                (preset) => tRoot(`datePresets.${preset}`),
              )}
            >
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
            {totalCount > rows.length ? (
              <p className="text-xs text-muted-foreground">
                {t("exportTruncated", {
                  shown: `${rows.length}`,
                  total: `${totalCount}`,
                })}
              </p>
            ) : null}
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
            compact
            items={[
              {
                label: t("kpiTotal"),
                value: String(totalCount),
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
                value: formatPct(approvalRate),
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
            <AppListCard className="h-full space-y-1 p-3 lg:col-span-2">
              <div className="flex items-baseline gap-2">
                <h3 className="text-sm font-semibold">{t("volumeTitle")}</h3>
                <p className="truncate text-xs text-muted-foreground">
                  {t("volumeSubtitle")}
                </p>
              </div>
              {maxVolume === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">{t("emptyTitle")}</p>
              ) : (
                <div className="flex h-10 items-end gap-1.5">
                  {volume.map((bucket) => (
                    <div
                      key={bucket.label}
                      className="flex h-full flex-1 flex-col items-center justify-end gap-1"
                      title={t("volumeTooltip", { week: bucket.label, count: bucket.count })}
                    >
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {bucket.count > 0 ? bucket.count : ""}
                      </span>
                      <div
                        className="w-full rounded-t-sm bg-primary/25"
                        style={{
                          height: `${Math.max(2, Math.round((bucket.count / maxVolume) * 80))}%`,
                        }}
                      />
                      <span className="text-xs text-muted-foreground">{bucket.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </AppListCard>

            <AppListCard className="h-full space-y-1 p-3">
              <div className="flex items-baseline gap-2">
                <h3 className="text-sm font-semibold">{t("stepTimeTitle")}</h3>
                <p className="truncate text-xs text-muted-foreground">
                  {t("stepTimeSubtitle")}
                </p>
              </div>
              {maxStepSeconds === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  {t("stepTimeEmpty")}
                </p>
              ) : (
                <div className="space-y-1">
                  {/* Slowest departments only — the table below carries every department,
                      so this card stays short enough to keep the page in one viewport. */}
                  {departmentRows
                    .filter((row) => row.avg_step_seconds != null)
                    .slice(0, 4)
                    .map((row) => (
                      <div key={row.department_key} className="space-y-0.5">
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
              <div className="border-b border-border px-3 py-1.5">
                <h3 className="text-sm font-semibold" title={t("byDepartmentSubtitle")}>
                  {t("byDepartment")}
                </h3>
                <p className="sr-only">{t("byDepartmentSubtitle")}</p>
              </div>
              <AppDataTable
                headerRowClassName="[&>th]:h-8"
                toolbar={
                  <TableToolbar
                    prefs={deptPrefs}
                    entity={t("byDepartment")}
                    columns={deptColumns}
                    rowKind="aggregate"
                    filteredCount={deptFiltered.length}
                    totalCount={departmentRows.length}
                    onExport={exportCsv}
                  />
                }
                columns={deptShown.map((column) => ({ id: column.id, label: column.label }))}
                empty={
                  deptFiltered.length === 0 ? (
                    <AppDataTableEmpty>{t("departmentEmpty")}</AppDataTableEmpty>
                  ) : undefined
                }
              >
                {deptFiltered.length === 0 ? null : (
                  deptFiltered.map((row) => {
                    const decided = row.approved + row.rejected;
                    const cells: Record<string, ReactNode> = {
                      department: <TableNameCell name={row.department_label} />,
                      requests: row.requests,
                      approved: row.approved,
                      rejected: row.rejected,
                      rate: decided === 0 ? <EmptyCell /> : formatPct((row.approved / decided) * 100),
                      avg:
                        row.avg_step_seconds == null ? (
                          <EmptyCell />
                        ) : (
                          `${formatDays(row.avg_step_seconds)}${t("days")}`
                        ),
                    };
                    return (
                      <AppDataTableRow key={row.department_key}>
                        {deptShown.map((column) => (
                          <TableCell key={column.id} className="tabular-nums">
                            {cells[column.id] ?? <EmptyCell />}
                          </TableCell>
                        ))}
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
                toolbar={
                  <TableToolbar
                    prefs={typePrefs}
                    entity={t("byType")}
                    columns={typeColumns}
                    rowKind="aggregate"
                    filteredCount={REQUEST_TYPES.filter((type) =>
                      tTypes(type).toLowerCase().includes(typePrefs.appliedQuery.trim().toLowerCase()),
                    ).length}
                    totalCount={REQUEST_TYPES.length}
                    onExport={exportCsv}
                  />
                }
                columns={typeShown.map((column) => ({ id: column.id, label: column.label }))}
                empty={
                  totalCount === 0 ? (
                    <AppDataTableEmpty>{t("emptyTitle")}</AppDataTableEmpty>
                  ) : undefined
                }
              >
                {totalCount === 0 ? null : (
                  REQUEST_TYPES.filter((type) =>
                    tTypes(type).toLowerCase().includes(typePrefs.appliedQuery.trim().toLowerCase()),
                  ).map((type) => {
                    const count = byType[type] ?? 0;
                    const share = totalCount > 0 ? Math.round((count / totalCount) * 100) : 0;
                    const cells: Record<string, ReactNode> = {
                      type: <TableNameCell name={tTypes(type)} />,
                      count,
                      share: `${share}%`,
                    };
                    return (
                      <AppDataTableRow key={type}>
                        {typeShown.map((column) => (
                          <TableCell key={column.id} className="tabular-nums">
                            {cells[column.id] ?? <EmptyCell />}
                          </TableCell>
                        ))}
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
                toolbar={
                  <TableToolbar
                    prefs={statusPrefs}
                    entity={t("byStatus")}
                    columns={statusColumns}
                    rowKind="aggregate"
                    filteredCount={REQUEST_STATUSES.filter((status) =>
                      tStatus(status).toLowerCase().includes(statusPrefs.appliedQuery.trim().toLowerCase()),
                    ).length}
                    totalCount={REQUEST_STATUSES.length}
                    onExport={exportCsv}
                  />
                }
                columns={statusShown.map((column) => ({ id: column.id, label: column.label }))}
                empty={
                  totalCount === 0 ? (
                    <AppDataTableEmpty>{t("emptyTitle")}</AppDataTableEmpty>
                  ) : undefined
                }
              >
                {totalCount === 0 ? null : (
                  REQUEST_STATUSES.filter((status) =>
                    tStatus(status).toLowerCase().includes(statusPrefs.appliedQuery.trim().toLowerCase()),
                  ).map((status) => {
                    const count = byStatus[status] ?? 0;
                    const share = totalCount > 0 ? Math.round((count / totalCount) * 100) : 0;
                    const framed = reportFrameStatus(status);
                    const cells: Record<string, ReactNode> = {
                      status: framed ? (
                        <StatusBadge status={framed} label={tStatus(status)} />
                      ) : (
                        <TableNameCell name={tStatus(status)} />
                      ),
                      count,
                      share: `${share}%`,
                    };
                    return (
                      <AppDataTableRow key={status}>
                        {statusShown.map((column) => (
                          <TableCell key={column.id} className="tabular-nums">
                            {cells[column.id] ?? <EmptyCell />}
                          </TableCell>
                        ))}
                      </AppDataTableRow>
                    );
                  })
                )}
              </AppDataTable>
            </AppListCard>
          )}

          <div className="space-y-1">
            <h3 className="text-sm font-semibold">{t("signaturesSection")}</h3>
            <div className="grid gap-2 lg:grid-cols-3 lg:items-stretch">
              <AppListCard className="h-full space-y-1 px-3 py-2">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  {t("esignTitle")}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-base font-semibold tabular-nums text-emerald-700">
                      {esignCounts?.signed ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">{t("esignSigned")}</p>
                  </div>
                  <div>
                    <p className="text-base font-semibold tabular-nums text-warning">
                      {esignCounts?.pending ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">{t("esignPending")}</p>
                  </div>
                  <div>
                    <p className="text-base font-semibold tabular-nums text-muted-foreground">
                      {esignCounts?.expired ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">{t("esignExpired")}</p>
                  </div>
                </div>
              </AppListCard>

              <AppListCard className="h-full space-y-1 px-3 py-2">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  {t("ackTitle")}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-base font-semibold tabular-nums">{pendingAck}</p>
                    <p className="text-xs text-muted-foreground">{t("ackPending")}</p>
                  </div>
                  <div title={t("ackGapNote")}>
                    <p className="text-base font-semibold tabular-nums text-muted-foreground">—</p>
                    <p className="text-xs text-muted-foreground">{t("ackRate")}</p>
                  </div>
                  <div title={t("ackGapNote")}>
                    <p className="text-base font-semibold tabular-nums text-muted-foreground">—</p>
                    <p className="text-xs text-muted-foreground">{t("ackAvgTime")}</p>
                  </div>
                </div>
                {/* Explains the two "—" values above without spending a third line on
                    an analytics page that has to fit one viewport. */}
                <p className="sr-only">{t("ackGapNote")}</p>
              </AppListCard>

              <AppListCard className="h-full space-y-1 px-3 py-2">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <span className="h-2 w-2 rounded-full bg-sky-500" />
                  {t("appointmentsTitle")}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-base font-semibold tabular-nums text-emerald-700">
                      {appointmentCounts?.accepted ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">{t("appointmentsAccepted")}</p>
                  </div>
                  <div>
                    <p className="text-base font-semibold tabular-nums text-warning">
                      {appointmentCounts?.pending ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">{t("appointmentsPending")}</p>
                  </div>
                  <div>
                    <p className="text-base font-semibold tabular-nums text-destructive">
                      {appointmentCounts?.rejected ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">{t("appointmentsRejected")}</p>
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
