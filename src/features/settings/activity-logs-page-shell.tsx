"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import { EmptyCell, TableNameCell, useTablePrefs, type TableToolbarColumn } from "@/components/app/table-toolbar";
import { groupBanner, groupRows, ListToolbar, rowMatches, visibleColumnIds } from "@/features/roster/table-kit";
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
  listAdminActivityFacets,
  listAdminActivityLogs,
  type AdminActivityFacets,
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
  const [entityType, setEntityType] = useState<string>("all");
  const [adminUserId, setAdminUserId] = useState<string>("all");
  const [facets, setFacets] = useState<AdminActivityFacets>({ entityTypes: [], admins: [] });
  const columns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "time", label: t("colTime") },
      { id: "user", label: t("colUser"), locked: true },
      { id: "action", label: t("colAction"), categorical: true },
      { id: "entity", label: t("colEntity"), categorical: true },
      { id: "route", label: t("colRoute") },
    ],
    [t],
  );
  const prefs = useTablePrefs("settings.activityLogs", columns);
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

  const entityFilterItems = useMemo(
    () =>
      selectOptions([
        { value: "all", label: t("allEntities") },
        ...facets.entityTypes.map((value) => ({ value, label: value })),
      ]),
    [facets.entityTypes, t],
  );

  const adminFilterItems = useMemo(
    () =>
      selectOptions([
        { value: "all", label: t("allAdmins") },
        ...facets.admins.map((admin) => ({
          value: admin.id,
          label: admin.name ?? admin.id.slice(0, 8),
        })),
      ]),
    [facets.admins, t],
  );

  const loadLogs = useCallback(() => {
    startTransition(async () => {
      const result = await listAdminActivityLogs({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        action: action === "all" ? undefined : (action as AdminActivityAction),
        entityType: entityType === "all" ? undefined : entityType,
        adminUserId: adminUserId === "all" ? undefined : adminUserId,
        search: prefs.appliedQuery.trim() || undefined,
        limit: 100,
      });
      if ("error" in result) {
        toast.error(t("loadFailed"));
        return;
      }
      setRows(result.rows);
    });
  }, [startDate, endDate, action, entityType, adminUserId, prefs.appliedQuery, t]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await listAdminActivityFacets();
      if (!cancelled && "facets" in result) setFacets(result.facets);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadRef = useRef(loadLogs);
  loadRef.current = loadLogs;
  useEffect(() => {
    loadRef.current();
  }, [prefs.appliedQuery]);

  const handleExport = () => {
    startTransition(async () => {
      const result = await exportAdminActivityLogsCsv({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        action: action === "all" ? undefined : (action as AdminActivityAction),
        entityType: entityType === "all" ? undefined : entityType,
        adminUserId: adminUserId === "all" ? undefined : adminUserId,
        search: prefs.appliedQuery.trim() || undefined,
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
            <div className="space-y-1.5">
              <Label>{t("entityFilter")}</Label>
              <Select
                items={entityFilterItems}
                value={entityType}
                onValueChange={(v) => setEntityType(v ?? "all")}
              >
                <SelectTrigger className="w-44 cursor-pointer rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" label={t("allEntities")}>
                    {t("allEntities")}
                  </SelectItem>
                  {facets.entityTypes.map((value) => (
                    <SelectItem key={value} value={value} label={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("adminFilter")}</Label>
              <Select
                items={adminFilterItems}
                value={adminUserId}
                onValueChange={(v) => setAdminUserId(v ?? "all")}
              >
                <SelectTrigger className="w-44 cursor-pointer rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" label={t("allAdmins")}>
                    {t("allAdmins")}
                  </SelectItem>
                  {facets.admins.map((admin) => (
                    <SelectItem
                      key={admin.id}
                      value={admin.id}
                      label={admin.name ?? admin.id.slice(0, 8)}
                    >
                      {admin.name ?? admin.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <ActivityLogTable
            columns={columns}
            prefs={prefs}
            rows={rows}
            emptyLabel={t("empty")}
            onExport={handleExport}
            onOpen={openRow}
          />
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

function ActivityLogTable({
  columns,
  prefs,
  rows,
  emptyLabel,
  onExport,
  onOpen,
}: {
  columns: TableToolbarColumn[];
  prefs: ReturnType<typeof useTablePrefs>;
  rows: AdminActivityLogRow[];
  emptyLabel: string;
  onExport: () => void;
  onOpen: (row: AdminActivityLogRow) => void;
}) {
  const matched = useMemo(
    () =>
      rows.filter((row) =>
        rowMatches(prefs.appliedQuery, [
          row.admin_name,
          row.action,
          row.entity_type,
          row.entity_id,
          row.route_name,
          row.page_path,
        ]),
      ),
    [prefs.appliedQuery, rows],
  );
  const groups = useMemo(
    () =>
      groupRows(matched, prefs.groupBy, (row) => {
        if (prefs.groupBy === "action") return row.action;
        if (prefs.groupBy === "entity") return row.entity_type ?? "";
        return "";
      }),
    [matched, prefs.groupBy],
  );
  const ids = visibleColumnIds(prefs);
  const heads = ids.map((id) => ({ id, label: columns.find((column) => column.id === id)?.label ?? id }));

  function cell(id: string, row: AdminActivityLogRow) {
    switch (id) {
      case "time":
        return new Date(row.created_at).toLocaleString();
      case "user":
        return <TableNameCell name={row.admin_name ?? row.admin_user_id?.slice(0, 8)} />;
      case "action":
        return row.action;
      case "entity": {
        const text = [row.entity_type, row.entity_id?.slice(0, 8)].filter(Boolean).join(" · ");
        return text ? text : <EmptyCell />;
      }
      case "route":
        return row.route_name ?? row.page_path ? (row.route_name ?? row.page_path) : <EmptyCell />;
      default:
        return <EmptyCell />;
    }
  }

  return (
    <AppDataTable
      toolbar={
        <ListToolbar
          prefs={prefs}
          entity="logs"
          columns={columns}
          rowKind="dynamic"
          filteredCount={matched.length}
          totalCount={rows.length}
          onExport={onExport}
        />
      }
      columns={heads}
      empty={matched.length === 0 ? <AppDataTableEmpty>{emptyLabel}</AppDataTableEmpty> : undefined}
    >
      {groups.map((group) => (
        <Fragment key={group.key}>
          {group.label ? (
            <AppDataTableRow>
              <TableCell colSpan={ids.length} className="bg-muted/40 text-xs font-semibold">
                {groupBanner(group.label, group.rows.length)}
              </TableCell>
            </AppDataTableRow>
          ) : null}
          {group.rows.map((row) => (
            <AppDataTableRow key={row.id} className="cursor-pointer" onClick={() => onOpen(row)}>
              {ids.map((id) => (
                <TableCell key={id} className="text-xs">
                  {cell(id, row)}
                </TableCell>
              ))}
            </AppDataTableRow>
          ))}
        </Fragment>
      ))}
    </AppDataTable>
  );
}
