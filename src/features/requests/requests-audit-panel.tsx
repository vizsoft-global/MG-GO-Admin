"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { selectOptions, selectOptionsFrom } from "@/lib/select-items";
import { fetchRequestsAuditLogs, type RequestsAuditLogRow } from "./requests-settings-actions";
import { datePresetToBounds } from "./date-presets";
import type { RequestDatePreset } from "./types";

const ACTION_TONE: Record<string, string> = {
  create: "border-emerald-200 bg-emerald-50 text-emerald-700",
  update: "border-primary/20 bg-primary/10 text-primary",
  delete: "border-destructive/20 bg-destructive/10 text-destructive",
  read: "border-border bg-muted/40 text-muted-foreground",
};

const DATE_PRESETS: RequestDatePreset[] = [
  "all",
  "today",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
];

/** Figma 10-Audit shows 10 rows per page so the table fits a 14" viewport. */
const PAGE_SIZE = 10;

function actionTone(action: string): string {
  return ACTION_TONE[action] ?? ACTION_TONE.read;
}

/** Figma shows day-first "12 Jul, 14:05" — the default locale string blows out the column. */
function formatTimestamp(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const day = new Intl.DateTimeFormat(locale, { day: "2-digit" }).format(date);
  const month = new Intl.DateTimeFormat(locale, { month: "short" }).format(date);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${day} ${month}, ${time}`;
}

function initialsOf(name: string): string {
  return (
    name
      .split(" ")
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

export function RequestsAuditPanel() {
  const t = useTranslations("pages.requests.settings.audit");
  const tRoot = useTranslations("pages.requests");
  const tTypes = useTranslations("pages.requests.types");
  const [rows, setRows] = useState<RequestsAuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [actorFilter, setActorFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<RequestDatePreset>("all");
  const [page, setPage] = useState(1);
  const locale = useLocale();

  const load = useCallback(() => {
    setLoading(true);
    void fetchRequestsAuditLogs().then((result) => {
      setLoading(false);
      if (result.error) {
        toast.error(result.error ?? t("errors.loadFailed"));
        return;
      }
      setRows(result.rows);
    });
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const actionOptions = useMemo(() => {
    const set = new Set(rows.map((r) => r.action));
    return Array.from(set).sort();
  }, [rows]);

  const actorOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      const id = row.actor_id ?? "system";
      if (!map.has(id)) map.set(id, row.actor_name);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const bounds = datePresetToBounds(datePreset);
    const fromMs = bounds.from ? Date.parse(bounds.from) : null;
    const toMs = bounds.to ? Date.parse(bounds.to) : null;
    return rows.filter((row) => {
      if (actionFilter !== "all" && row.action !== actionFilter) return false;
      if (actorFilter !== "all" && (row.actor_id ?? "system") !== actorFilter) return false;
      const createdMs = Date.parse(row.created_at);
      if (fromMs != null && createdMs < fromMs) return false;
      if (toMs != null && createdMs >= toMs) return false;
      if (!q) return true;
      return (
        (row.route_name ?? "").toLowerCase().includes(q) ||
        (row.target_code ?? "").toLowerCase().includes(q) ||
        (row.entity_id ?? "").toLowerCase().includes(q) ||
        row.actor_name.toLowerCase().includes(q) ||
        (row.details ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, actionFilter, actorFilter, datePreset]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedRows = useMemo(
    () => filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredRows, currentPage],
  );

  useEffect(() => {
    setPage(1);
  }, [search, actionFilter, actorFilter, datePreset]);

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: tRoot("title"), href: "/requests" },
          { label: tRoot("settings.title"), href: "/requests/settings" },
          { label: t("title") },
        ]}
        actions={
          <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 text-[11px] font-medium text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
            {t("readOnly")}
          </span>
        }
      />

      <AppListCard className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <Select
            value={actorFilter}
            onValueChange={(v) => v && setActorFilter(v)}
            items={selectOptions([
              { value: "all", label: t("allStaff") },
              ...actorOptions.map(([id, name]) => ({ value: id, label: name })),
            ])}
          >
            <SelectTrigger className="h-9 w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allStaff")}</SelectItem>
              {actorOptions.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={actionFilter}
            onValueChange={(v) => v && setActionFilter(v)}
            items={selectOptions([
              { value: "all", label: t("allActions") },
              ...actionOptions.map((action) => ({ value: action, label: action })),
            ])}
          >
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allActions")}</SelectItem>
              {actionOptions.map((action) => (
                <SelectItem key={action} value={action}>
                  {action}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={datePreset}
            onValueChange={(v) => v && setDatePreset(v as RequestDatePreset)}
            items={selectOptionsFrom(
              DATE_PRESETS,
              (preset) => preset,
              (preset) => tRoot(`datePresets.${preset}`),
            )}
          >
            <SelectTrigger className="h-9 w-[150px]">
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
          <Input
            className="h-9 w-56"
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="ms-auto text-[11px] text-muted-foreground">
            {loading ? "" : t("eventCount", { count: filteredRows.length })}
          </span>
        </div>
        <AppDataTable
          columns={[
            { id: "when", label: t("colWhen") },
            { id: "actor", label: t("colActor") },
            { id: "action", label: t("colAction") },
            { id: "target", label: t("colTarget") },
            { id: "details", label: t("colDetails") },
          ]}
          empty={
            loading ? (
              <AppDataTableEmpty>
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              </AppDataTableEmpty>
            ) : filteredRows.length === 0 ? (
              <AppDataTableEmpty>{t("empty")}</AppDataTableEmpty>
            ) : undefined
          }
        >
          {loading || filteredRows.length === 0 ? null : (
            pagedRows.map((row) => (
              <AppDataTableRow key={row.id}>
                <TableCell className="text-xs whitespace-nowrap">
                  {formatTimestamp(row.created_at, locale)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="text-[9px]">
                        {initialsOf(row.actor_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{row.actor_name}</p>
                      {row.actor_role ? (
                        <p className="truncate text-[10px] text-muted-foreground">
                          {row.actor_role}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span
                    className={`inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-semibold capitalize ${actionTone(row.action)}`}
                  >
                    {row.action}
                  </span>
                </TableCell>
                <TableCell className="max-w-[200px]">
                  <p className="truncate text-xs">
                    {row.target_code
                      ? `${row.target_code}${row.target_type ? ` · ${tTypes(row.target_type)}` : ""}`
                      : (row.route_name ?? "—")}
                  </p>
                  {row.target_code && row.route_name ? (
                    <p className="truncate text-[10px] text-muted-foreground">{row.route_name}</p>
                  ) : null}
                </TableCell>
                <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground">
                  {row.details ?? "—"}
                </TableCell>
              </AppDataTableRow>
            ))
          )}
        </AppDataTable>
        {!loading && filteredRows.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-1">
            <span className="text-[11px] text-muted-foreground">
              {t("range", {
                from: (currentPage - 1) * PAGE_SIZE + 1,
                to: (currentPage - 1) * PAGE_SIZE + pagedRows.length,
                total: filteredRows.length,
              })}
            </span>
            <div className="ms-auto flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                {t("prev")}
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {t("pageOf", { page: currentPage, pages: pageCount })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                disabled={currentPage >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                {t("next")}
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : null}
      </AppListCard>
    </AppPage>
  );
}
