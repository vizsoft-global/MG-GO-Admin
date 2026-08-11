"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

function actionTone(action: string): string {
  return ACTION_TONE[action] ?? ACTION_TONE.read;
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
  const [rows, setRows] = useState<RequestsAuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [actorFilter, setActorFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<RequestDatePreset>("all");

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
        (row.entity_id ?? "").toLowerCase().includes(q) ||
        row.actor_name.toLowerCase().includes(q) ||
        (row.details ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, actionFilter, actorFilter, datePreset]);

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
          <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 text-[11px] font-medium text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
            {t("readOnly")}
          </span>
        }
      />

      <AppListCard className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <Select value={actorFilter} onValueChange={(v) => v && setActorFilter(v)}>
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
          <Select value={actionFilter} onValueChange={(v) => v && setActionFilter(v)}>
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
        >
          {loading ? (
            <AppDataTableEmpty>
              <Loader2 className="mx-auto h-4 w-4 animate-spin" />
            </AppDataTableEmpty>
          ) : filteredRows.length === 0 ? (
            <AppDataTableEmpty>{t("empty")}</AppDataTableEmpty>
          ) : (
            filteredRows.map((row) => (
              <AppDataTableRow key={row.id}>
                <TableCell className="text-xs whitespace-nowrap">
                  {new Date(row.created_at).toLocaleString()}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="text-[10px]">
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
                  <p className="truncate text-xs">{row.route_name ?? "—"}</p>
                  {row.entity_id ? (
                    <p className="truncate font-mono text-[10px] text-muted-foreground">
                      {row.entity_id}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground">
                  {row.details ?? "—"}
                </TableCell>
              </AppDataTableRow>
            ))
          )}
        </AppDataTable>
      </AppListCard>
    </AppPage>
  );
}
