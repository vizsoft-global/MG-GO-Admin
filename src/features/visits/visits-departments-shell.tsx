"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Building2, Loader2, Pencil, RefreshCw } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { groupRows } from "@/components/app/app-list-controls";
import {
  EmptyCell,
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/auth-context";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import {
  createVisitDepartment,
  fetchVisitBranches,
  fetchVisitDepartments,
  updateVisitDepartment,
  type VisitDepartmentRow,
} from "./visits-actions";

/** Sentinel for "offered at every branch", which is stored as a NULL branch_id. */
const ALL_BRANCHES = "all";

type DeptDraft = {
  id?: string;
  key: string;
  label_en: string;
  label_ar: string;
  desk_location: string;
  desks_count: string;
  assigned_staff_name: string;
  avg_handling_minutes: string;
  branch_id: string;
  is_active: boolean;
};

function emptyDraft(): DeptDraft {
  return {
    key: "",
    label_en: "",
    label_ar: "",
    desk_location: "",
    desks_count: "1",
    assigned_staff_name: "",
    avg_handling_minutes: "10",
    branch_id: ALL_BRANCHES,
    is_active: true,
  };
}

function draftFromRow(row: VisitDepartmentRow): DeptDraft {
  return {
    id: row.id,
    key: row.key,
    label_en: row.label_en,
    label_ar: row.label_ar ?? "",
    desk_location: row.desk_location ?? "",
    desks_count: String(row.desks_count ?? 1),
    assigned_staff_name: row.assigned_staff_name ?? "",
    avg_handling_minutes: row.avg_handling_minutes != null ? String(row.avg_handling_minutes) : "",
    branch_id: row.branch_id ?? ALL_BRANCHES,
    is_active: row.is_active,
  };
}

export function VisitsDepartmentsShell() {
  const t = useTranslations("pages.visitBookings");
  const { can } = useAuth();
  const canManage = can("visits.manage_catalog");
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<DeptDraft>(emptyDraft());

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: queryKeys.visits.departments(),
    queryFn: () => fetchVisitDepartments(),
  });
  const { data: branchesData } = useQuery({
    queryKey: queryKeys.visits.branches(),
    queryFn: fetchVisitBranches,
  });

  const rows = data?.rows ?? [];
  const branches = branchesData?.rows ?? [];
  const branchNameById = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch.name])),
    [branches],
  );
  const deptColumns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "dept", label: t("colDepartment"), locked: true },
      { id: "branch", label: t("colBranch"), categorical: true },
      { id: "desk", label: t("departments.deskCounter") },
      { id: "staff", label: t("departments.assignedStaff") },
      { id: "handling", label: t("departments.avgHandling") },
      { id: "status", label: t("colStatus"), categorical: true },
      { id: "actions", label: t("colActions"), locked: true },
    ],
    [t],
  );
  const tablePrefs = useTablePrefs("visits.departments", deptColumns);
  const filteredRows = useMemo(() => {
    const query = tablePrefs.appliedQuery.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      [row.label_en, row.label_ar, branchNameById.get(row.branch_id ?? "") ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [branchNameById, rows, tablePrefs.appliedQuery]);
  const grouped = useMemo(
    () =>
      groupRows(
        filteredRows,
        tablePrefs.groupBy,
        {
          branch: (row) => (row.branch_id ? branchNameById.get(row.branch_id) : t("departments.branchAll")),
          status: (row) => (row.is_active ? t("catalog.active") : t("slots.inactive")),
        },
        {},
        "—",
      ),
    [branchNameById, filteredRows, t, tablePrefs.groupBy],
  );
  const shownColumns = tablePrefs.orderedColumns.filter((column) => tablePrefs.isVisible(column.id));
  const branchItems = [
    { value: ALL_BRANCHES, label: t("departments.branchAll") },
    ...branches.map((b) => ({ value: b.id, label: b.name })),
  ];

  const openCreate = () => {
    setDraft(emptyDraft());
    setDialogOpen(true);
  };

  const openEdit = (row: VisitDepartmentRow) => {
    setDraft(draftFromRow(row));
    setDialogOpen(true);
  };

  const save = async () => {
    const minutes = draft.avg_handling_minutes ? Number(draft.avg_handling_minutes) : null;
    if (draft.avg_handling_minutes && (!Number.isFinite(minutes) || (minutes ?? 0) < 0)) {
      toast.error(t("departments.handlingInvalid"));
      return;
    }
    const desks = Number(draft.desks_count);
    if (!Number.isInteger(desks) || desks < 0) {
      toast.error(t("departments.desksInvalid"));
      return;
    }

    const branchId = draft.branch_id === ALL_BRANCHES ? null : draft.branch_id;

    setBusy(true);
    const result = draft.id
      ? await updateVisitDepartment({
          id: draft.id,
          desk_location: draft.desk_location.trim() || null,
          desks_count: desks,
          assigned_staff_name: draft.assigned_staff_name.trim() || null,
          avg_handling_minutes: minutes,
          branch_id: branchId,
          is_active: draft.is_active,
        })
      : await createVisitDepartment({
          key: draft.key.trim(),
          label_en: draft.label_en.trim(),
          label_ar: draft.label_ar.trim() || null,
          desk_location: draft.desk_location.trim() || null,
          desks_count: desks,
          assigned_staff_name: draft.assigned_staff_name.trim() || null,
          avg_handling_minutes: minutes,
          branch_id: branchId,
        });
    setBusy(false);

    if (!result.ok) {
      toast.error(
        result.error === "invalid_desks_count"
          ? t("departments.desksInvalid")
          : (result.error ?? t("catalog.saveFailed")),
      );
      return;
    }
    toast.success(t("catalog.saved"));
    setDialogOpen(false);
    await queryClient.invalidateQueries({ queryKey: queryKeys.visits.departments() });
  };

  const toggleActive = async (id: string, is_active: boolean) => {
    const result = await updateVisitDepartment({ id, is_active });
    if (!result.ok) {
      toast.error(result.error ?? t("catalog.saveFailed"));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: queryKeys.visits.departments() });
  };

  return (
    <AppPage>
      <AppPageHeader
        breadcrumbs={[
          { label: t("title"), href: "/visit-bookings" },
          { label: t("departments.pageTitle") },
        ]}
        title={t("departments.pageTitle")}
        description={t("departments.pageSubtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t("departments.countLabel", { count: rows.length })}
            </span>
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

      <AppListCard className="mt-2 p-0">
        <TableToolbar
          prefs={tablePrefs}
          entity={t("departments.pageTitle")}
          columns={deptColumns}
          rowKind="dynamic"
          entityList
          filteredCount={filteredRows.length}
          totalCount={rows.length}
          onAdd={canManage ? openCreate : undefined}
          addLabel={t("departments.add")}
        />
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <AppEmptyState
            title={t("departments.emptyTitle")}
            description={t("departments.emptyDescription")}
          />
        ) : (
          <AppDataTable
            columns={shownColumns.map((column) => ({ id: column.id, label: column.label }))}
          >
            {grouped.flatMap((group) => [
              ...(tablePrefs.groupBy !== "none"
                ? [
                    <AppDataTableRow key={`g-${group.key}`} className="hover:bg-transparent">
                      <TableCell colSpan={shownColumns.length} className="text-xs font-semibold">
                        {group.label} · {group.rows.length}
                      </TableCell>
                    </AppDataTableRow>,
                  ]
                : []),
              ...group.rows.map((row) => {
                const cells: Record<string, ReactNode> = {
                  dept: <TableNameCell name={row.label_en} />,
                  branch: row.branch_id ? (
                    <span className="inline-flex items-center gap-1 text-foreground">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                      {branchNameById.get(row.branch_id) ?? row.branch_id}
                    </span>
                  ) : (
                    t("departments.branchAll")
                  ),
                  desk: (
                    <>
                      <span className="tabular-nums text-foreground">
                        {t("departments.desksValue", { count: row.desks_count })}
                      </span>
                      {row.desk_location ? (
                        <p className="text-xs text-muted-foreground">{row.desk_location}</p>
                      ) : null}
                    </>
                  ),
                  staff: row.assigned_staff_name ? <TableNameCell name={row.assigned_staff_name} /> : <EmptyCell />,
                  handling:
                    row.avg_handling_minutes != null ? (
                      t("departments.minutesValue", { minutes: row.avg_handling_minutes })
                    ) : (
                      <EmptyCell />
                    ),
                  status: canManage ? (
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={row.is_active}
                        onCheckedChange={(checked) => void toggleActive(row.id, checked)}
                      />
                      <span className={cn("text-xs font-medium", row.is_active ? "text-success" : "text-muted-foreground")}>
                        {row.is_active ? t("catalog.active") : t("slots.inactive")}
                      </span>
                    </div>
                  ) : (
                    <StatusPill variant={row.is_active ? "success" : "neutral"}>
                      {row.is_active ? t("catalog.active") : t("slots.inactive")}
                    </StatusPill>
                  ),
                  actions: canManage ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 text-primary hover:bg-primary/10"
                      onClick={() => openEdit(row)}
                    >
                      <Pencil className="me-1 h-3.5 w-3.5" />
                      {t("catalog.edit")}
                    </Button>
                  ) : (
                    <EmptyCell />
                  ),
                };
                return (
              <AppDataTableRow key={row.id}>
                {shownColumns.map((column) => (
                  <TableCell key={column.id}>{cells[column.id] ?? <EmptyCell />}</TableCell>
                ))}
              </AppDataTableRow>
                );
              }),
            ])}
          </AppDataTable>
        )}
      </AppListCard>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="overflow-visible pt-4" showCloseButton closeOutside>
          <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
            {!draft.id ? (
              <>
                <div className="space-y-1">
                  <Label>{t("catalog.key")}</Label>
                  <Input
                    className="h-9 font-mono"
                    value={draft.key}
                    onChange={(e) => setDraft((d) => ({ ...d, key: e.target.value }))}
                    placeholder="e.g. finance"
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t("catalog.label")}</Label>
                  <Input
                    className="h-9"
                    value={draft.label_en}
                    onChange={(e) => setDraft((d) => ({ ...d, label_en: e.target.value }))}
                  />
                </div>
              </>
            ) : null}
            <div className="space-y-1">
              <Label>{t("departments.deskCounter")}</Label>
              <Input
                type="number"
                min={0}
                className="h-9"
                value={draft.desks_count}
                onChange={(e) => setDraft((d) => ({ ...d, desks_count: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("departments.deskLocation")}</Label>
              <Input
                className="h-9"
                value={draft.desk_location}
                onChange={(e) => setDraft((d) => ({ ...d, desk_location: e.target.value }))}
                placeholder="Counter 1 · Ground floor"
              />
            </div>
            <div className="space-y-1">
              <Label>{t("departments.assignedStaff")}</Label>
              <Input
                className="h-9"
                value={draft.assigned_staff_name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, assigned_staff_name: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>{t("departments.avgHandling")}</Label>
              <Input
                type="number"
                min={0}
                className="h-9"
                value={draft.avg_handling_minutes}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, avg_handling_minutes: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>{t("colBranch")}</Label>
              <Select
                items={branchItems}
                value={draft.branch_id}
                onValueChange={(v) => v && setDraft((d) => ({ ...d, branch_id: v }))}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {branchItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("departments.branchHint")}
              </p>
            </div>
            {draft.id ? (
              <div className="flex items-center gap-2 sm:col-span-2">
                <Switch
                  checked={draft.is_active}
                  onCheckedChange={(checked) => setDraft((d) => ({ ...d, is_active: checked }))}
                />
                <span className="text-sm">{t("catalog.active")}</span>
              </div>
            ) : null}
          </div>

          <AppModalFooter
            title={draft.id ? t("departments.editTitle") : t("departments.addTitle")}
            subtitle={t("departments.modalSubtitle")}
          >
            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={() => setDialogOpen(false)}
            >
              {t("catalog.cancel")}
            </Button>
            <Button
              type="button"
              className="h-9"
              disabled={busy || (!draft.id && (!draft.key.trim() || !draft.label_en.trim()))}
              onClick={() => void save()}
            >
              {t("catalog.save")}
            </Button>
          </AppModalFooter>
        </DialogContent>
      </Dialog>
    </AppPage>
  );
}
