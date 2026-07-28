"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import { deleteDeliveryRule, isDpdErrorKey } from "./dpd-actions";
import { DpdStatusBadge } from "./dpd-status-badge";
import { RuleFormSheet } from "./rule-form-sheet";
import type { DeliveryRuleRow } from "./types";
import { useDeliveryRules, useDpdScopeOptions } from "./use-dpd";

export function DeliveryRulesPageShell() {
  const t = useTranslations("pages.dpd");
  const tPage = useTranslations("pages.deliveryRules");
  const { can } = useAuth();
  const canManage = can("earnings.manage");
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();

  const { data: scopeOptions } = useDpdScopeOptions();
  const { data: deliveryRules, isLoading } = useDeliveryRules();

  const [sheet, setSheet] = useState<{ open: boolean; row: DeliveryRuleRow | null }>({
    open: false,
    row: null,
  });
  const [deleteTarget, setDeleteTarget] = useState<DeliveryRuleRow | null>(null);

  const handleDelete = () => {
    if (!deleteTarget) return;
    startTransition(async () => {
      const result = await deleteDeliveryRule(deleteTarget.id);
      if (result.error) {
        toast.error(
          isDpdErrorKey(result.error) ? t(`errors.${result.error}`) : t("errors.delete_failed"),
        );
        throw new Error(result.error);
      }
      toast.success(t("deliveryRuleDeleted"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.dpd.deliveryRules() });
      setDeleteTarget(null);
    });
  };

  return (
    <AppPage>
      <AppPageHeader
        title={tPage("title")}
        description={tPage("subtitle")}
        actions={
          canManage ? (
            <Button
              type="button"
              size="sm"
              className="cursor-pointer rounded-lg"
              onClick={() => setSheet({ open: true, row: null })}
            >
              <Plus className="h-4 w-4" />
              {t("addDeliveryRule")}
            </Button>
          ) : null
        }
      />
      <AppListCard>
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (deliveryRules?.length ?? 0) === 0 ? (
          <AppEmptyState title={t("emptyDeliveryRules")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className={TABLE_HEAD_CLASS}>{t("colName")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colScope")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colDates")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colPriority")}</TableHead>
                {canManage ? (
                  <TableHead className={cn(TABLE_HEAD_CLASS, "w-24 text-end")}>
                    {t("edit")}
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(deliveryRules ?? []).map((row) => (
                <TableRow key={row.id} className="hover:bg-muted/40">
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>{row.scope_label}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.start_date} → {row.end_date}
                  </TableCell>
                  <TableCell>
                    <DpdStatusBadge status={row.status} />
                  </TableCell>
                  <TableCell>{row.priority}</TableCell>
                  {canManage ? (
                    <TableCell className="text-end">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="cursor-pointer"
                          onClick={() => setSheet({ open: true, row })}
                          aria-label={t("editDeliveryRule")}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="cursor-pointer text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setDeleteTarget(row)}
                          aria-label={t("delete")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </AppListCard>

      <RuleFormSheet
        rule={sheet.row}
        options={scopeOptions}
        open={sheet.open}
        onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
      />

      {deleteTarget ? (
        <ConfirmDeleteDialog
          open={Boolean(deleteTarget)}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          itemTitle={t("deleteDeliveryRuleTitle")}
          itemName={deleteTarget.name}
          confirmText={deleteTarget.name}
          onConfirm={handleDelete}
          isPending={isPending}
        />
      ) : null}
    </AppPage>
  );
}
