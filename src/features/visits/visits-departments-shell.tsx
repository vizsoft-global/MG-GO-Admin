"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Pencil, Plus, RefreshCw } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
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
import { StatusPill } from "@/components/dashboard/status-pill";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/auth-context";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import {
  createVisitDepartment,
  fetchVisitDepartments,
  updateVisitDepartment,
  type VisitDepartmentRow,
} from "./visits-actions";
import { avatarTintClass, departmentBadgeClass, initialsOf } from "./visit-status-utils";

type DeptDraft = {
  id?: string;
  key: string;
  label_en: string;
  label_ar: string;
  desk_location: string;
  assigned_staff_name: string;
  avg_handling_minutes: string;
  is_active: boolean;
};

function emptyDraft(): DeptDraft {
  return {
    key: "",
    label_en: "",
    label_ar: "",
    desk_location: "",
    assigned_staff_name: "",
    avg_handling_minutes: "10",
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
    assigned_staff_name: row.assigned_staff_name ?? "",
    avg_handling_minutes: row.avg_handling_minutes != null ? String(row.avg_handling_minutes) : "",
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

  const rows = data?.rows ?? [];

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

    setBusy(true);
    const result = draft.id
      ? await updateVisitDepartment({
          id: draft.id,
          desk_location: draft.desk_location.trim() || null,
          assigned_staff_name: draft.assigned_staff_name.trim() || null,
          avg_handling_minutes: minutes,
          is_active: draft.is_active,
        })
      : await createVisitDepartment({
          key: draft.key.trim(),
          label_en: draft.label_en.trim(),
          label_ar: draft.label_ar.trim() || null,
          desk_location: draft.desk_location.trim() || null,
          assigned_staff_name: draft.assigned_staff_name.trim() || null,
          avg_handling_minutes: minutes,
        });
    setBusy(false);

    if (!result.ok) {
      toast.error(result.error ?? t("catalog.saveFailed"));
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
            <span className="text-[11px] text-muted-foreground">
              {t("departments.countLabel", { count: rows.length })}
            </span>
            {canManage ? (
              <Button type="button" size="sm" className="h-9" onClick={openCreate}>
                <Plus className="me-1.5 h-3.5 w-3.5" />
                {t("departments.add")}
              </Button>
            ) : null}
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
            columns={[
              { id: "dept", label: t("colDepartment") },
              { id: "desk", label: t("departments.deskCounter") },
              { id: "staff", label: t("departments.assignedStaff") },
              { id: "handling", label: t("departments.avgHandling") },
              { id: "status", label: t("colStatus") },
              { id: "actions", label: t("colActions") },
            ]}
          >
            {rows.map((row) => (
              <AppDataTableRow key={row.id}>
                <TableCell>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                      departmentBadgeClass(row.key),
                    )}
                  >
                    {row.label_en}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {row.desk_location ?? "—"}
                </TableCell>
                <TableCell>
                  {row.assigned_staff_name ? (
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                          avatarTintClass(row.assigned_staff_name),
                        )}
                      >
                        {initialsOf(row.assigned_staff_name)}
                      </span>
                      <span className="text-sm">{row.assigned_staff_name}</span>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm tabular-nums text-muted-foreground">
                  {row.avg_handling_minutes != null
                    ? t("departments.minutesValue", { minutes: row.avg_handling_minutes })
                    : "—"}
                </TableCell>
                <TableCell>
                  {canManage ? (
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={row.is_active}
                        onCheckedChange={(checked) => void toggleActive(row.id, checked)}
                      />
                      <span
                        className={cn(
                          "text-xs font-medium",
                          row.is_active ? "text-success" : "text-muted-foreground",
                        )}
                      >
                        {row.is_active ? t("catalog.active") : t("slots.inactive")}
                      </span>
                    </div>
                  ) : (
                    <StatusPill variant={row.is_active ? "success" : "neutral"}>
                      {row.is_active ? t("catalog.active") : t("slots.inactive")}
                    </StatusPill>
                  )}
                </TableCell>
                <TableCell>
                  {canManage ? (
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
                    <span className="text-[11px] text-muted-foreground">—</span>
                  )}
                </TableCell>
              </AppDataTableRow>
            ))}
          </AppDataTable>
        )}
      </AppListCard>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="overflow-visible pt-4" showCloseButton closeOutside>
          <div className="grid gap-3 sm:grid-cols-2">
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
