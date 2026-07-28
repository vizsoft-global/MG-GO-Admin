"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  exportAdminActivityLogsCsv,
  listAdminActivityLogs,
  type AdminActivityLogRow,
} from "@/lib/audit/audit-actions";
import type { AdminActivityAction } from "@/lib/audit/log-admin-activity";
import { selectOptions } from "@/lib/select-items";

const ACTION_OPTIONS: AdminActivityAction[] = [
  "create",
  "update",
  "delete",
  "view",
  "read",
  "auth",
  "export",
  "recalculate",
];

export function ActivityLogsPageShell() {
  const t = useTranslations("pages.auditLogs");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [action, setAction] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<AdminActivityLogRow[]>([]);
  const [selected, setSelected] = useState<AdminActivityLogRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const actionFilterItems = useMemo(
    () =>
      selectOptions([
        { value: "all", label: t("allActions") },
        ...ACTION_OPTIONS.map((a) => ({ value: a, label: a })),
      ]),
    [t],
  );

  const loadLogs = useCallback(() => {
    startTransition(async () => {
      const result = await listAdminActivityLogs({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        action: action === "all" ? undefined : (action as AdminActivityAction),
        search: search.trim() || undefined,
        limit: 100,
      });
      if ("error" in result) {
        toast.error(t("loadFailed"));
        return;
      }
      setRows(result.rows);
    });
  }, [startDate, endDate, action, search, t]);

  const handleExport = () => {
    startTransition(async () => {
      const result = await exportAdminActivityLogsCsv({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        action: action === "all" ? undefined : (action as AdminActivityAction),
        search: search.trim() || undefined,
      });
      if ("error" in result) {
        toast.error(t("exportFailed"));
        return;
      }
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `admin-activity-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("exportDone"));
    });
  };

  const openRow = (row: AdminActivityLogRow) => {
    setSelected(row);
    setSheetOpen(true);
  };

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer rounded-lg"
              onClick={handleExport}
              disabled={isPending}
            >
              <Download className="me-1.5 size-4" />
              {t("export")}
            </Button>
            <Button
              type="button"
              className="cursor-pointer rounded-lg"
              onClick={loadLogs}
              disabled={isPending}
            >
              {isPending ? <Loader2 className="size-4 animate-spin" /> : t("load")}
            </Button>
          </div>
        }
      />
      <AppListCard>
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label>{t("startDate")}</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40 rounded-lg" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("endDate")}</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40 rounded-lg" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("actionFilter")}</Label>
              <Select
                items={actionFilterItems}
                value={action}
                onValueChange={(v) => setAction(v ?? "all")}
              >
                <SelectTrigger className="w-40 cursor-pointer rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" label={t("allActions")}>
                    {t("allActions")}
                  </SelectItem>
                  {ACTION_OPTIONS.map((a) => (
                    <SelectItem key={a} value={a} label={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[12rem] flex-1 space-y-1.5">
              <Label>{t("search")}</Label>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="rounded-lg"
              />
            </div>
          </div>

          <AppDataTable
            columns={[
              { id: "time", label: t("colTime") },
              { id: "user", label: t("colUser") },
              { id: "action", label: t("colAction") },
              { id: "entity", label: t("colEntity") },
              { id: "route", label: t("colRoute") },
            ]}
            empty={
              rows.length === 0 ? (
                <AppDataTableEmpty>{t("empty")}</AppDataTableEmpty>
              ) : undefined
            }
          >
            {rows.map((row) => (
              <AppDataTableRow
                key={row.id}
                className="cursor-pointer"
                onClick={() => openRow(row)}
              >
                <TableCell className="text-xs tabular-nums">
                  {new Date(row.created_at).toLocaleString()}
                </TableCell>
                <TableCell className="text-sm">
                  {row.admin_name ?? row.admin_user_id?.slice(0, 8) ?? "—"}
                </TableCell>
                <TableCell className="font-mono text-xs">{row.action}</TableCell>
                <TableCell className="text-xs">
                  {[row.entity_type, row.entity_id?.slice(0, 8)].filter(Boolean).join(" · ") || "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {row.route_name ?? row.page_path ?? "—"}
                </TableCell>
              </AppDataTableRow>
            ))}
          </AppDataTable>
        </div>
      </AppListCard>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="flex w-full flex-col p-0 sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{t("detailTitle")}</SheetTitle>
            <SheetDescription>
              {selected?.action} · {selected?.entity_type}
            </SheetDescription>
          </SheetHeader>
          {selected ? (
            <SheetBody className="space-y-4 text-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground">{t("colUser")}</p>
                  <p>{selected.admin_name ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t("colTime")}</p>
                  <p>{new Date(selected.created_at).toLocaleString()}</p>
                </div>
              </div>
              {selected.changed_fields.length > 0 ? (
                <div>
                  <p className="mb-1 font-medium">{t("changedFields")}</p>
                  <p className="text-muted-foreground">{selected.changed_fields.join(", ")}</p>
                </div>
              ) : null}
              <div>
                <p className="mb-1 font-medium">{t("before")}</p>
                <pre className="max-h-48 overflow-auto rounded-lg bg-muted/40 p-2 text-xs">
                  {JSON.stringify(selected.before_state, null, 2) ?? "null"}
                </pre>
              </div>
              <div>
                <p className="mb-1 font-medium">{t("after")}</p>
                <pre className="max-h-48 overflow-auto rounded-lg bg-muted/40 p-2 text-xs">
                  {JSON.stringify(selected.after_state, null, 2) ?? "null"}
                </pre>
              </div>
              {Object.keys(selected.context).length > 0 ? (
                <div>
                  <p className="mb-1 font-medium">{t("context")}</p>
                  <pre className="max-h-32 overflow-auto rounded-lg bg-muted/40 p-2 text-xs">
                    {JSON.stringify(selected.context, null, 2)}
                  </pre>
                </div>
              ) : null}
            </SheetBody>
          ) : null}
        </SheetContent>
      </Sheet>
    </AppPage>
  );
}
