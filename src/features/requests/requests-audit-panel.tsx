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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchRequestsAuditLogs, type RequestsAuditLogRow } from "./requests-settings-actions";

const ACTION_TONE: Record<string, string> = {
  create: "border-emerald-200 bg-emerald-50 text-emerald-700",
  update: "border-primary/20 bg-primary/10 text-primary",
  delete: "border-destructive/20 bg-destructive/10 text-destructive",
  read: "border-border bg-muted/40 text-muted-foreground",
};

function actionTone(action: string): string {
  return ACTION_TONE[action] ?? ACTION_TONE.read;
}

export function RequestsAuditPanel() {
  const t = useTranslations("pages.requests.settings.audit");
  const [rows, setRows] = useState<RequestsAuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");

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

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (actionFilter !== "all" && row.action !== actionFilter) return false;
      if (!q) return true;
      return (
        (row.route_name ?? "").toLowerCase().includes(q) ||
        (row.entity_id ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, actionFilter]);

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
          <span className="inline-flex h-7 items-center rounded-md border border-border bg-muted/40 px-2 text-[11px] font-medium text-muted-foreground">
            {t("readOnly")}
          </span>
        }
      />

      <AppListCard className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
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
            { id: "action", label: t("colAction") },
            { id: "route", label: t("colRoute") },
            { id: "entity", label: t("colEntity") },
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
                  <span
                    className={`inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-semibold capitalize ${actionTone(row.action)}`}
                  >
                    {row.action}
                  </span>
                </TableCell>
                <TableCell className="text-xs">{row.route_name ?? "—"}</TableCell>
                <TableCell className="font-mono text-[10px]">{row.entity_id ?? "—"}</TableCell>
              </AppDataTableRow>
            ))
          )}
        </AppDataTable>
      </AppListCard>
    </AppPage>
  );
}
