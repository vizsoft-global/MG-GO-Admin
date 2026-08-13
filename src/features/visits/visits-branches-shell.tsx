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
  createVisitBranch,
  fetchVisitBranches,
  updateVisitBranch,
  type VisitBranchRow,
} from "./visits-actions";
import { formatWorkingHours } from "./visit-status-utils";

const WEEKDAY_DEFAULT = "0,1,2,3,4"; // Sun-Thu

type BranchDraft = {
  id?: string;
  key: string;
  name: string;
  address: string;
  city: string;
  opening_time: string;
  closing_time: string;
  desks_count: string;
  is_active: boolean;
};

function emptyDraft(): BranchDraft {
  return {
    key: "",
    name: "",
    address: "",
    city: "",
    opening_time: "09:00",
    closing_time: "17:00",
    desks_count: "1",
    is_active: true,
  };
}

function draftFromRow(row: VisitBranchRow): BranchDraft {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    address: row.address ?? "",
    city: row.city ?? "",
    opening_time: row.opening_time ? row.opening_time.slice(0, 5) : "09:00",
    closing_time: row.closing_time ? row.closing_time.slice(0, 5) : "17:00",
    desks_count: String(row.desks_count ?? 1),
    is_active: row.is_active,
  };
}

export function VisitsBranchesShell() {
  const t = useTranslations("pages.visitBookings");
  const { can } = useAuth();
  const canManage = can("visits.manage_catalog");
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<BranchDraft>(emptyDraft());

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: queryKeys.visits.branches(),
    queryFn: () => fetchVisitBranches(),
  });

  const rows = data?.rows ?? [];

  const openCreate = () => {
    setDraft(emptyDraft());
    setDialogOpen(true);
  };

  const openEdit = (row: VisitBranchRow) => {
    setDraft(draftFromRow(row));
    setDialogOpen(true);
  };

  const save = async () => {
    const desks = Number(draft.desks_count);
    if (!Number.isFinite(desks) || desks < 1) {
      toast.error(t("branches.desksInvalid"));
      return;
    }

    setBusy(true);
    const result = draft.id
      ? await updateVisitBranch({
          id: draft.id,
          name: draft.name.trim(),
          address: draft.address.trim() || null,
          city: draft.city.trim() || null,
          opening_time: draft.opening_time,
          closing_time: draft.closing_time,
          desks_count: desks,
          is_active: draft.is_active,
        })
      : await createVisitBranch({
          key: draft.key.trim(),
          name: draft.name.trim(),
          address: draft.address.trim() || null,
          city: draft.city.trim() || null,
          working_days: WEEKDAY_DEFAULT,
          opening_time: draft.opening_time,
          closing_time: draft.closing_time,
          desks_count: desks,
        });
    setBusy(false);

    if (!result.ok) {
      toast.error(result.error ?? t("catalog.saveFailed"));
      return;
    }
    toast.success(t("catalog.saved"));
    setDialogOpen(false);
    await queryClient.invalidateQueries({ queryKey: queryKeys.visits.branches() });
  };

  return (
    <AppPage>
      <AppPageHeader
        breadcrumbs={[
          { label: t("title"), href: "/visit-bookings" },
          { label: t("branches.title") },
        ]}
        title={t("branches.title")}
        description={t("branches.subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canManage ? (
              <Button type="button" size="sm" className="h-9" onClick={openCreate}>
                <Plus className="me-1.5 h-3.5 w-3.5" />
                {t("branches.add")}
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

      <AppListCard className="mt-2">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <AppEmptyState
            title={t("branches.emptyTitle")}
            description={t("branches.emptyDescription")}
          />
        ) : (
          <AppDataTable
            columns={[
              { id: "name", label: t("branches.colBranch") },
              { id: "address", label: t("branches.colAddressCity") },
              { id: "hours", label: t("branches.colWorkingHours") },
              { id: "desks", label: t("branches.colDesks") },
              { id: "status", label: t("colStatus") },
              { id: "actions", label: t("colActions") },
            ]}
          >
            {rows.map((row) => (
              <AppDataTableRow key={row.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{row.name}</span>
                    {row.is_default ? (
                      <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        {t("branches.default")}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="max-w-[220px] truncate text-sm text-muted-foreground">
                  {[row.address, row.city].filter(Boolean).join(", ") || "—"}
                </TableCell>
                <TableCell className="text-sm tabular-nums text-muted-foreground">
                  {formatWorkingHours(row)}
                </TableCell>
                <TableCell className="tabular-nums">
                  {t("branches.desksValue", { count: row.desks_count })}
                </TableCell>
                <TableCell>
                  <StatusPill variant={row.is_active ? "success" : "neutral"}>
                    {row.is_active ? t("catalog.active") : t("slots.inactive")}
                  </StatusPill>
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
              <div className="space-y-1">
                <Label>{t("catalog.key")}</Label>
                <Input
                  className="h-9 font-mono"
                  value={draft.key}
                  onChange={(e) => setDraft((d) => ({ ...d, key: e.target.value }))}
                  placeholder="e.g. deira"
                />
              </div>
            ) : null}
            <div className={cn("space-y-1", !draft.id ? "" : "sm:col-span-2")}>
              <Label htmlFor="branch-name">{t("catalog.name")}</Label>
              <Input
                id="branch-name"
                className="h-9"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="branch-address">{t("catalog.address")}</Label>
              <Input
                id="branch-address"
                className="h-9"
                value={draft.address}
                onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("branches.city")}</Label>
              <Input
                className="h-9"
                value={draft.city}
                onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("slots.startTime")}</Label>
              <Input
                type="time"
                className="h-9"
                value={draft.opening_time}
                onChange={(e) => setDraft((d) => ({ ...d, opening_time: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("slots.endTime")}</Label>
              <Input
                type="time"
                className="h-9"
                value={draft.closing_time}
                onChange={(e) => setDraft((d) => ({ ...d, closing_time: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("branches.desks")}</Label>
              <Input
                type="number"
                min={1}
                className="h-9"
                value={draft.desks_count}
                onChange={(e) => setDraft((d) => ({ ...d, desks_count: e.target.value }))}
              />
            </div>
            {draft.id ? (
              <div className="flex items-center gap-2">
                <Switch
                  checked={draft.is_active}
                  onCheckedChange={(checked) => setDraft((d) => ({ ...d, is_active: checked }))}
                />
                <span className="text-sm">{t("catalog.active")}</span>
              </div>
            ) : null}
          </div>
          <AppModalFooter
            title={draft.id ? t("branches.editTitle") : t("branches.addTitle")}
            subtitle={draft.key || t("branches.modalSubtitle")}
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
              disabled={busy || !draft.name.trim() || (!draft.id && !draft.key.trim())}
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
