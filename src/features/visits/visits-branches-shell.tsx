"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Pencil, RefreshCw } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/auth-context";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import {
  fetchVisitBranches,
  updateVisitBranch,
  type VisitBranchRow,
} from "./visits-actions";
import { VisitsTabBar } from "./visits-tab-bar";

export function VisitsBranchesShell() {
  const t = useTranslations("pages.visitBookings");
  const { can } = useAuth();
  const canManage = can("visits.manage_catalog");
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<VisitBranchRow | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftAddress, setDraftAddress] = useState("");
  const [draftActive, setDraftActive] = useState(true);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: queryKeys.visits.branches(),
    queryFn: () => fetchVisitBranches(),
  });

  const rows = data?.rows ?? [];

  const openEdit = (row: VisitBranchRow) => {
    setEditRow(row);
    setDraftName(row.name);
    setDraftAddress(row.address ?? "");
    setDraftActive(row.is_active);
  };

  const saveBranch = async () => {
    if (!editRow) return;
    setBusyId(editRow.id);
    const result = await updateVisitBranch({
      id: editRow.id,
      name: draftName.trim(),
      address: draftAddress.trim() || null,
      is_active: draftActive,
    });
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.error ?? t("catalog.saveFailed"));
      return;
    }
    toast.success(t("catalog.saved"));
    setEditRow(null);
    await queryClient.invalidateQueries({ queryKey: queryKeys.visits.branches() });
  };

  return (
    <AppPage>
      <AppPageHeader
        title={t("branches.title")}
        description={t("branches.subtitle")}
        actions={
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
            title={t("branches.emptyTitle")}
            description={t("branches.emptyDescription")}
          />
        ) : (
          <AppDataTable
            columns={[
              { id: "key", label: t("catalog.key") },
              { id: "name", label: t("catalog.name") },
              { id: "address", label: t("catalog.address") },
              { id: "active", label: t("catalog.active") },
              { id: "actions", label: t("colActions") },
            ]}
          >
            {rows.map((row) => (
              <AppDataTableRow key={row.id}>
                <TableCell className="font-mono text-xs">{row.key}</TableCell>
                <TableCell className="text-sm font-medium">{row.name}</TableCell>
                <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                  {row.address ?? "—"}
                </TableCell>
                <TableCell className="text-sm">
                  {row.is_active ? t("catalog.yes") : t("catalog.no")}
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

      <Dialog open={editRow != null} onOpenChange={(open) => !open && setEditRow(null)}>
        <DialogContent className="overflow-visible pt-4" showCloseButton closeOutside>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="branch-name">{t("catalog.name")}</Label>
              <Input
                id="branch-name"
                className="h-9"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="branch-address">{t("catalog.address")}</Label>
              <Input
                id="branch-address"
                className="h-9"
                value={draftAddress}
                onChange={(e) => setDraftAddress(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={draftActive} onCheckedChange={setDraftActive} />
              <span className="text-sm">{t("catalog.active")}</span>
            </div>
          </div>
          <AppModalFooter
            title={t("branches.editTitle")}
            subtitle={editRow?.key}
          >
            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={() => setEditRow(null)}
            >
              {t("catalog.cancel")}
            </Button>
            <Button
              type="button"
              className="h-9"
              disabled={!draftName.trim() || busyId === editRow?.id}
              onClick={() => void saveBranch()}
            >
              {t("catalog.save")}
            </Button>
          </AppModalFooter>
        </DialogContent>
      </Dialog>
    </AppPage>
  );
}
