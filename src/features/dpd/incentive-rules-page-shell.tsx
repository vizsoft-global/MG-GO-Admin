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
import { deleteIncentiveRule, isDpdErrorKey } from "./dpd-actions";
import { DpdStatusBadge } from "./dpd-status-badge";
import { IncentiveRuleFormSheet } from "./incentive-rule-form-sheet";
import {
  formatIncentiveRewardSummary,
  formatIncentiveTargetSummary,
  type IncentiveRuleRow,
} from "./types";
import { useDpdScopeOptions, useIncentiveRules } from "./use-dpd";

export function IncentiveRulesPageShell() {
  const t = useTranslations("pages.dpd");
  const tPage = useTranslations("pages.incentiveRules");
  const { can } = useAuth();
  const canManage = can("earnings.manage");
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();

  const { data: scopeOptions } = useDpdScopeOptions();
  const { data: incentiveRules, isLoading } = useIncentiveRules();

  const [sheet, setSheet] = useState<{ open: boolean; row: IncentiveRuleRow | null }>({
    open: false,
    row: null,
  });
  const [deleteTarget, setDeleteTarget] = useState<IncentiveRuleRow | null>(null);

  const handleDelete = () => {
    if (!deleteTarget) return;
    startTransition(async () => {
      const result = await deleteIncentiveRule(deleteTarget.id);
      if (result.error) {
        toast.error(
          isDpdErrorKey(result.error) ? t(`errors.${result.error}`) : t("errors.delete_failed"),
        );
        throw new Error(result.error);
      }
      toast.success(t("incentiveRuleDeleted"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.dpd.incentiveRules() });
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
              {t("addIncentiveRule")}
            </Button>
          ) : null
        }
      />
      <p className="text-sm text-muted-foreground">{t("stackingHint")}</p>

      <AppListCard>
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (incentiveRules?.length ?? 0) === 0 ? (
          <AppEmptyState title={t("emptyIncentiveRules")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className={TABLE_HEAD_CLASS}>{t("colName")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colScope")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colPeriod")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colTarget")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colReward")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
                {canManage ? (
                  <TableHead className={cn(TABLE_HEAD_CLASS, "w-24 text-end")}>
                    {t("edit")}
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(incentiveRules ?? []).map((row) => (
                <TableRow key={row.id} className="hover:bg-muted/40">
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>{row.scope_label}</TableCell>
                  <TableCell>{t(`period.${row.period}`)}</TableCell>
                  <TableCell>
                    {formatIncentiveTargetSummary(row, (key, values) =>
                      t(key, values),
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums text-sm">
                    {formatIncentiveRewardSummary(row, (key, values) =>
                      t(key, values),
                    )}
                  </TableCell>
                  <TableCell>
                    <DpdStatusBadge status={row.status} />
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-end">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="cursor-pointer"
                          onClick={() => setSheet({ open: true, row })}
                          aria-label={t("editIncentiveRule")}
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

      <IncentiveRuleFormSheet
        rule={sheet.row}
        options={scopeOptions}
        open={sheet.open}
        onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
      />

      {deleteTarget ? (
        <ConfirmDeleteDialog
          open={Boolean(deleteTarget)}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          itemTitle={t("deleteIncentiveRuleTitle")}
          itemName={deleteTarget.name}
          confirmText={deleteTarget.name}
          onConfirm={handleDelete}
          isPending={isPending}
        />
      ) : null}
    </AppPage>
  );
}
