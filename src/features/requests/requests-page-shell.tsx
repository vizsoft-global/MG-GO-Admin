"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
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
import type { RequestDatePreset } from "./types";
import { useAdminRequestsList } from "./use-requests";

function formatAvgDays(seconds: number | null): string {
  if (seconds == null || Number.isNaN(seconds)) return "—";
  return `${(seconds / 86400).toFixed(1)}d`;
}

function trendDelta(current: number, previous: number | null): string {
  if (previous == null) return "";
  const delta = current - previous;
  if (delta === 0) return "±0";
  return delta > 0 ? `+${delta}` : `${delta}`;
}

function statusVariant(
  status: string,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "approved" || status === "solved") return "success";
  if (status === "rejected") return "danger";
  if (status === "needs_clarification" || status === "overdue") return "warning";
  return "neutral";
}

function kpiValue(current: number | string, previous: number | null): string {
  const base = String(current);
  const delta = trendDelta(
    typeof current === "number" ? current : Number(current) || 0,
    previous,
  );
  return delta ? `${base} (${delta})` : base;
}

const DATE_PRESETS: RequestDatePreset[] = [
  "today",
  "this_week",
  "this_month",
  "last_month",
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

export function RequestsPageShell() {
  const t = useTranslations("pages.requests");
  const router = useRouter();
  const [datePreset, setDatePreset] = useState<RequestDatePreset>("this_month");
  const [type, setType] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [searchApplied, setSearchApplied] = useState("");

  const filters = useMemo(
    () => ({
      datePreset,
      type: type === "all" ? null : type,
      search: searchApplied,
      limit: 50,
      offset: 0,
    }),
    [datePreset, type, searchApplied],
  );

  const { data, isLoading, isFetching, refetch } = useAdminRequestsList(filters);
  const rows = data?.rows ?? [];
  const kpi = data?.kpi;

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
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
            value: kpi ? kpiValue(kpi.total, kpi.prev_total) : "—",
          },
          {
            label: t("kpi.pending"),
            value: kpi ? kpiValue(kpi.pending, kpi.prev_pending) : "—",
            accent: "warning",
          },
          {
            label: t("kpi.avgResolution"),
            value: formatAvgDays(kpi?.avg_resolution_seconds ?? null),
          },
          {
            label: t("kpi.overdue"),
            value: kpi ? kpiValue(kpi.overdue, kpi.prev_overdue) : "—",
            accent: "danger",
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
                  row.needs_attention && "bg-amber-50/80 dark:bg-amber-950/20",
                )}
                onClick={() => router.push(`/requests/${row.id}`)}
              >
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    {row.needs_attention ? (
                      <span
                        className="inline-block h-2 w-2 rounded-full bg-amber-500"
                        title={t("attentionBadge")}
                      />
                    ) : null}
                    <span className="font-medium tabular-nums">{row.request_code}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.driver_name}</p>
                    <p className="text-[11px] text-muted-foreground">{row.driver_code}</p>
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
                  <StatusPill variant={statusVariant(row.status)}>
                    {t(`status.${row.status}` as "status.pending")}
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
