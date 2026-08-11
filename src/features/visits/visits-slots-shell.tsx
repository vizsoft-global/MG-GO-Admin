"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { StatusPill } from "@/components/dashboard/status-pill";
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
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/auth-context";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import {
  deactivateVisitSlot,
  fetchVisitBranches,
  fetchVisitDepartments,
  fetchVisitSlots,
  upsertVisitSlot,
  type VisitSlotRow,
} from "./visits-actions";
import { DAY_OF_WEEK_LABELS } from "./visit-status-utils";
import { VisitsTabBar } from "./visits-tab-bar";

type SlotDraft = {
  id?: string;
  department_key: string;
  branch_id: string;
  scheduleType: "weekday" | "date";
  day_of_week: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  capacity: string;
  is_active: boolean;
};

function emptyDraft(): SlotDraft {
  return {
    department_key: "",
    branch_id: "",
    scheduleType: "weekday",
    day_of_week: "0",
    slot_date: "",
    start_time: "09:00",
    end_time: "09:30",
    capacity: "2",
    is_active: true,
  };
}

function draftFromRow(row: VisitSlotRow): SlotDraft {
  return {
    id: row.id,
    department_key: row.department_key,
    branch_id: row.branch_id ?? "",
    scheduleType: row.slot_date ? "date" : "weekday",
    day_of_week: String(row.day_of_week ?? 0),
    slot_date: row.slot_date ?? "",
    start_time: row.start_time.slice(0, 5),
    end_time: row.end_time.slice(0, 5),
    capacity: String(row.capacity),
    is_active: row.is_active,
  };
}

function formatSchedule(row: VisitSlotRow): string {
  if (row.slot_date) return row.slot_date;
  if (row.day_of_week != null) return DAY_OF_WEEK_LABELS[row.day_of_week] ?? `DOW ${row.day_of_week}`;
  return "—";
}

export function VisitsSlotsShell() {
  const t = useTranslations("pages.visitBookings");
  const { can } = useAuth();
  const canManage = can("visits.manage_catalog");
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<SlotDraft>(emptyDraft());

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: queryKeys.visits.slots(),
    queryFn: () => fetchVisitSlots(),
  });

  const { data: deptData } = useQuery({
    queryKey: queryKeys.visits.departments(),
    queryFn: () => fetchVisitDepartments(),
  });

  const { data: branchData } = useQuery({
    queryKey: queryKeys.visits.branches(),
    queryFn: () => fetchVisitBranches(),
  });

  const rows = data?.rows ?? [];
  const departments = useMemo(
    () => (deptData?.rows ?? []).filter((d) => d.is_active),
    [deptData?.rows],
  );
  const branches = useMemo(
    () => (branchData?.rows ?? []).filter((b) => b.is_active),
    [branchData?.rows],
  );

  const openCreate = () => {
    setDraft({
      ...emptyDraft(),
      department_key: departments[0]?.key ?? "",
      branch_id: branches[0]?.id ?? "",
    });
    setDialogOpen(true);
  };

  const openEdit = (row: VisitSlotRow) => {
    setDraft(draftFromRow(row));
    setDialogOpen(true);
  };

  const saveSlot = async () => {
    if (!draft.department_key) {
      toast.error(t("slots.departmentRequired"));
      return;
    }
    const capacity = Number(draft.capacity);
    if (!Number.isFinite(capacity) || capacity < 1) {
      toast.error(t("slots.capacityInvalid"));
      return;
    }

    setBusyId(draft.id ?? "new");
    const result = await upsertVisitSlot({
      id: draft.id,
      department_key: draft.department_key,
      branch_id: draft.branch_id || null,
      slot_date: draft.scheduleType === "date" ? draft.slot_date || null : null,
      day_of_week:
        draft.scheduleType === "weekday" ? Number(draft.day_of_week) : null,
      start_time: draft.start_time,
      end_time: draft.end_time,
      capacity,
      is_active: draft.is_active,
    });
    setBusyId(null);

    if (!result.ok) {
      toast.error(result.error ?? t("catalog.saveFailed"));
      return;
    }
    toast.success(t("catalog.saved"));
    setDialogOpen(false);
    await queryClient.invalidateQueries({ queryKey: queryKeys.visits.slots() });
  };

  const deactivate = async (slotId: string) => {
    setBusyId(slotId);
    const result = await deactivateVisitSlot(slotId);
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.error ?? t("catalog.saveFailed"));
      return;
    }
    toast.success(t("slots.deactivated"));
    await queryClient.invalidateQueries({ queryKey: queryKeys.visits.slots() });
  };

  return (
    <AppPage>
      <AppPageHeader
        title={t("slots.title")}
        description={t("slots.subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canManage ? (
              <Button type="button" size="sm" className="h-9" onClick={openCreate}>
                <Plus className="me-1.5 h-3.5 w-3.5" />
                {t("slots.add")}
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

      <VisitsTabBar />

      <AppListCard className="mt-2">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <AppEmptyState
            title={t("slots.emptyTitle")}
            description={t("slots.emptyDescription")}
          />
        ) : (
          <AppDataTable
            columns={[
              { id: "dept", label: t("colDepartment") },
              { id: "branch", label: t("detail.branch") },
              { id: "schedule", label: t("slots.schedule") },
              { id: "time", label: t("slots.time") },
              { id: "capacity", label: t("slots.capacity") },
              { id: "status", label: t("colStatus") },
              { id: "actions", label: t("colActions") },
            ]}
          >
            {rows.map((row) => (
              <AppDataTableRow key={row.id}>
                <TableCell className="text-sm">{row.department_label}</TableCell>
                <TableCell className="text-sm">{row.branch_name ?? "—"}</TableCell>
                <TableCell className="text-sm tabular-nums">
                  {formatSchedule(row)}
                </TableCell>
                <TableCell className="text-sm tabular-nums">
                  {row.start_time.slice(0, 5)} – {row.end_time.slice(0, 5)}
                </TableCell>
                <TableCell className="tabular-nums">{row.capacity}</TableCell>
                <TableCell>
                  <StatusPill variant={row.is_active ? "success" : "neutral"}>
                    {row.is_active ? t("catalog.active") : t("slots.inactive")}
                  </StatusPill>
                </TableCell>
                <TableCell>
                  {canManage ? (
                    <div className="flex flex-wrap gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 text-primary hover:bg-primary/10"
                        onClick={() => openEdit(row)}
                      >
                        {t("catalog.edit")}
                      </Button>
                      {row.is_active ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 text-destructive hover:bg-destructive/10"
                          disabled={busyId === row.id}
                          onClick={() => void deactivate(row.id)}
                        >
                          <Trash2 className="me-1 h-3.5 w-3.5" />
                          {t("slots.deactivate")}
                        </Button>
                      ) : null}
                    </div>
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
            <div className="space-y-1 sm:col-span-2">
              <Label>{t("colDepartment")}</Label>
              <Select
                value={draft.department_key}
                onValueChange={(v) => {
                  if (v) setDraft((d) => ({ ...d, department_key: v }));
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={t("slots.selectDepartment")} />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.key} value={d.key} label={d.label_en}>
                      {d.label_en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label>{t("detail.branch")}</Label>
              <Select
                value={draft.branch_id || "__none__"}
                onValueChange={(v) => {
                  if (v)
                    setDraft((d) => ({
                      ...d,
                      branch_id: v === "__none__" ? "" : v,
                    }));
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={t("slots.optionalBranch")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" label={t("slots.noBranch")}>
                    {t("slots.noBranch")}
                  </SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id} label={b.name}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>{t("slots.scheduleType")}</Label>
              <Select
                value={draft.scheduleType}
                onValueChange={(v) => {
                  if (v) setDraft((d) => ({ ...d, scheduleType: v as "weekday" | "date" }));
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekday" label={t("slots.weekday")}>
                    {t("slots.weekday")}
                  </SelectItem>
                  <SelectItem value="date" label={t("slots.specificDate")}>
                    {t("slots.specificDate")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {draft.scheduleType === "weekday" ? (
              <div className="space-y-1">
                <Label>{t("slots.dayOfWeek")}</Label>
                <Select
                  value={draft.day_of_week}
                  onValueChange={(v) => {
                    if (v) setDraft((d) => ({ ...d, day_of_week: v }));
                  }}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAY_OF_WEEK_LABELS.map((label, idx) => (
                      <SelectItem key={label} value={String(idx)} label={label}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1">
                <Label>{t("slots.slotDate")}</Label>
                <Input
                  type="date"
                  className="h-9"
                  value={draft.slot_date}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, slot_date: e.target.value }))
                  }
                />
              </div>
            )}

            <div className="space-y-1">
              <Label>{t("slots.startTime")}</Label>
              <Input
                type="time"
                className="h-9"
                value={draft.start_time}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, start_time: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>{t("slots.endTime")}</Label>
              <Input
                type="time"
                className="h-9"
                value={draft.end_time}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, end_time: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>{t("slots.capacity")}</Label>
              <Input
                type="number"
                min={1}
                className="h-9"
                value={draft.capacity}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, capacity: e.target.value }))
                }
              />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Switch
                checked={draft.is_active}
                onCheckedChange={(checked) =>
                  setDraft((d) => ({ ...d, is_active: checked }))
                }
              />
              <span className="text-sm">{t("catalog.active")}</span>
            </div>
          </div>

          <AppModalFooter
            title={draft.id ? t("slots.editTitle") : t("slots.addTitle")}
            subtitle={t("slots.modalSubtitle")}
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
              disabled={busyId != null}
              onClick={() => void saveSlot()}
            >
              {t("catalog.save")}
            </Button>
          </AppModalFooter>
        </DialogContent>
      </Dialog>
    </AppPage>
  );
}
