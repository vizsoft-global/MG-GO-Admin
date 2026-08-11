"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { requestStatusLabelKey, requestStatusVariant } from "./request-status-utils";
import type { RequestDatePreset } from "./types";
import { useAdminRequestsList } from "./use-requests";

function formatAvgDays(seconds: number | null): string {
  if (seconds == null || Number.isNaN(seconds)) return "—";
  return `${(seconds / 86400).toFixed(1)}d`;
}

/** Trend caption vs previous month (locked KPI rule). `lowerIsBetter` flips the tone. */
function trendCaption(
  current: number,
  previous: number | null,
  lowerIsBetter: boolean,
  t: (key: string, values?: Record<string, string>) => string,
) {
  if (previous == null) return null;
  const delta = current - previous;
  if (delta === 0) {
    return <span className="text-muted-foreground">{t("kpi.trendFlat")}</span>;
  }
  const improved = lowerIsBetter ? delta < 0 : delta > 0;
  const Icon = delta > 0 ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5",
        improved ? "text-success" : "text-danger",
      )}
    >
      <Icon className="h-3 w-3" />
      {t("kpi.trendDelta", { delta: `${Math.abs(delta)}` })}
    </span>
  );
}

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

const TYPE_FILTERS = [
  "all",
  "leave",
  "sick_leave",
  "loan",
  "asset",
  "fuel",
  "document",
  "complaint",
  "salary_justification",
] as const;

export function RequestsPageShell({
  initialType = "all",
}: {
  initialType?: string;
}) {
  const t = useTranslations("pages.requests");
  const router = useRouter();
  const [datePreset, setDatePreset] = useState<RequestDatePreset>("this_month");
  const [type, setType] = useState<string>(
    TYPE_FILTERS.includes(initialType as (typeof TYPE_FILTERS)[number])
      ? initialType
      : "all",
  );
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [searchApplied, setSearchApplied] = useState("");

  const STATUS_FILTERS = [
    "all",
    "submitted",
    "pending",
    "in_review",
    "needs_clarification",
    "approved",
    "rejected",
    "solved",
    "overdue",
  ] as const;

  const filters = useMemo(
    () => ({
      datePreset,
      type: type === "all" ? null : type,
      status: status === "all" ? null : status,
      search: searchApplied,
      limit: 50,
      offset: 0,
    }),
    [datePreset, type, status, searchApplied],
  );

  const { data, isLoading, isFetching, refetch } = useAdminRequestsList(filters);
  const rows = data?.rows ?? [];
  const kpi = data?.kpi;

  return (
    <AppPage>
      <AppPageHeader
        title={t("overviewTitle")}
        description={t("subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              render={<Link href="/requests" />}
            >
              {t("hubLink")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              render={<Link href="/requests/esign" />}
            >
              {t("esignLink")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              render={<Link href="/requests/settings" />}
            >
              {t("settingsLink")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <RefreshCw
                className={cn("me-1.5 h-3.5 w-3.5", isFetching && "animate-spin")}
              />
              {t("refresh")}
            </Button>
          </div>
        }
      />

      <KpiGrid
        items={[
          {
            label: t("kpi.total"),
            value: kpi ? kpi.total : "—",
            caption: kpi ? trendCaption(kpi.total, kpi.prev_total, false, t) : null,
          },
          {
            label: t("kpi.pending"),
            value: kpi ? kpi.pending : "—",
            accent: "warning",
            caption: kpi ? trendCaption(kpi.pending, kpi.prev_pending, true, t) : null,
          },
          {
            label: t("kpi.avgResolution"),
            value: formatAvgDays(kpi?.avg_resolution_seconds ?? null),
            caption:
              kpi?.avg_resolution_seconds != null && kpi.prev_avg_resolution_seconds != null
                ? trendCaption(
                    Number((kpi.avg_resolution_seconds / 86400).toFixed(1)),
                    Number((kpi.prev_avg_resolution_seconds / 86400).toFixed(1)),
                    true,
                    t,
                  )
                : null,
          },
          {
            label: t("kpi.overdue"),
            value: kpi ? kpi.overdue : "—",
            accent: "danger",
            caption: kpi ? trendCaption(kpi.overdue, kpi.prev_overdue, true, t) : null,
          },
        ]}
      />

      <AppListCard className="mt-2">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <Select
            items={DATE_PRESETS.map((preset) => ({
              value: preset,
              label: t(`datePresets.${preset}`),
            }))}
            value={datePreset}
            onValueChange={(v) => {
              if (v) setDatePreset(v as RequestDatePreset);
            }}
          >
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue placeholder={t("filters.date")} />
            </SelectTrigger>
            <SelectContent>
              {DATE_PRESETS.map((preset) => (
                <SelectItem
                  key={preset}
                  value={preset}
                  label={t(`datePresets.${preset}`)}
                >
                  {t(`datePresets.${preset}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            items={TYPE_FILTERS.map((key) => ({
              value: key,
              label: t(`types.${key}`),
            }))}
            value={type}
            onValueChange={(v) => {
              if (v) setType(v);
            }}
          >
            <SelectTrigger className="h-9 w-[180px]">
              <SelectValue placeholder={t("filters.type")} />
            </SelectTrigger>
            <SelectContent>
              {TYPE_FILTERS.map((key) => (
                <SelectItem key={key} value={key} label={t(`types.${key}`)}>
                  {t(`types.${key}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            items={STATUS_FILTERS.map((key) => ({
              value: key,
              label:
                key === "all"
                  ? t("statusFilter.all")
                  : t(`status.${key}` as "status.pending"),
            }))}
            value={status}
            onValueChange={(v) => {
              if (v) setStatus(v);
            }}
          >
            <SelectTrigger className="h-9 w-[180px]">
              <SelectValue placeholder={t("filters.status")} />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((key) => (
                <SelectItem
                  key={key}
                  value={key}
                  label={
                    key === "all"
                      ? t("statusFilter.all")
                      : t(`status.${key}` as "status.pending")
                  }
                >
                  {key === "all"
                    ? t("statusFilter.all")
                    : t(`status.${key}` as "status.pending")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            className="h-9 max-w-xs"
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setSearchApplied(search.trim());
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => setSearchApplied(search.trim())}
          >
            {t("search")}
          </Button>
        </div>

        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <AppEmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
        ) : (
          <AppDataTable
            columns={[
              { id: "code", label: t("colCode") },
              { id: "driver", label: t("colDriver") },
              { id: "type", label: t("colType") },
              { id: "step", label: t("colStep") },
              { id: "status", label: t("colStatus") },
              { id: "date", label: t("colDate") },
              { id: "actions", label: t("colActions") },
            ]}
          >
            {rows.map((row) => (
              <AppDataTableRow
                key={row.id}
                className={cn(
                  "cursor-pointer",
                  row.needs_attention && "bg-primary/10",
                )}
                onClick={() => router.push(`/requests/${row.id}`)}
              >
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    {row.needs_attention ? (
                      <span
                        className="inline-block h-2 w-2 rounded-full bg-primary"
                        title={t("attentionBadge")}
                      />
                    ) : null}
                    <span className="font-medium tabular-nums">{row.request_code}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.driver_name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {row.driver_zone
                        ? t("zoneLabel", { zone: row.driver_zone })
                        : row.driver_code}
                    </p>
                    <Link
                      href={`/requests/${row.id}`}
                      className="text-[10px] text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t("viewDetails")}
                    </Link>
                  </div>
                </TableCell>
                <TableCell className="text-sm">
                  {t(`types.${row.request_type}` as "types.leave")}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {row.current_step_label ?? "—"}
                </TableCell>
                <TableCell>
                  <StatusPill
                    variant={requestStatusVariant(row.status, {
                      awaiting_driver_ack: row.awaiting_driver_ack,
                    })}
                  >
                    {t(
                      `status.${requestStatusLabelKey(row.status, {
                        awaiting_driver_ack: row.awaiting_driver_ack,
                      })}` as "status.pending",
                    )}
                  </StatusPill>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground tabular-nums">
                  {row.created_at
                    ? new Date(row.created_at).toLocaleString()
                    : "—"}
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-primary hover:bg-primary/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/requests/${row.id}`);
                    }}
                  >
                    <ExternalLink className="me-1 h-3.5 w-3.5" />
                    {t("open")}
                  </Button>
                </TableCell>
              </AppDataTableRow>
            ))}
          </AppDataTable>
        )}
      </AppListCard>
    </AppPage>
  );
}
