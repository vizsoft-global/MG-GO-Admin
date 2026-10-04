"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppPage, AppPageHeader } from "@/components/app";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { deleteIncentiveRule, isDpdErrorKey } from "./dpd-actions";
import { DpdStatusBadge } from "./dpd-status-badge";
import { IncentiveRuleFormSheet } from "./incentive-rule-form-sheet";
import {
  formatIncentiveRewardSummary,
  formatIncentiveTargetSummary,
  type IncentiveRuleRow,
} from "./types";
import { useDpdScopeOptions } from "./use-dpd";

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm font-medium">{children}</div>
    </div>
  );
}

export function IncentiveRuleDetailPageShell({
  rule,
}: {
  rule: IncentiveRuleRow;
}) {
  const t = useTranslations("pages.dpd");
  const tPage = useTranslations("pages.incentiveRules");
  const { can } = useAuth();
  const canManage = can("earnings.manage");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: scopeOptions } = useDpdScopeOptions();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<IncentiveRuleRow | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    if (!deleteTarget) return;
    startTransition(async () => {
      const result = await deleteIncentiveRule(deleteTarget.id);
      if (result.error) {
        toast.error(
          isDpdErrorKey(result.error)
            ? t(`errors.${result.error}`)
            : t("errors.delete_failed"),
        );
        throw new Error(result.error);
      }
      toast.success(t("incentiveRuleDeleted"));
      void queryClient.invalidateQueries({
        queryKey: queryKeys.dpd.incentiveRules(),
      });
      setDeleteTarget(null);
      router.replace("/incentive-rules");
    });
  };

  return (
    <AppPage>
      <AppPageHeader
        title={rule.name}
        description={tPage("detailSubtitle")}
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              className="h-9 cursor-pointer rounded-lg"
              onClick={() => router.push("/incentive-rules")}
            >
              <ArrowLeft className="me-2 h-3.5 w-3.5" />
              {tPage("backToList")}
            </Button>
            {canManage ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 cursor-pointer rounded-lg text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleteTarget(rule)}
                >
                  <Trash2 className="me-2 h-3.5 w-3.5" />
                  {t("delete")}
                </Button>
                <Button
                  type="button"
                  className="h-9 cursor-pointer rounded-lg"
                  onClick={() => setEditOpen(true)}
                >
                  <Pencil className="me-2 h-3.5 w-3.5" />
                  {t("editIncentiveRule")}
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <Card className="rounded-xl border-border shadow-sm">
        <CardContent className="p-4">
          <DetailRow label={t("colScope")}>{rule.scope_label || "—"}</DetailRow>
          <DetailRow label={t("colPeriod")}>{t(`period.${rule.period}`)}</DetailRow>
          <DetailRow label={t("fields.targetMode")}>
            {t(`targetTypes.${rule.target_mode}`)}
          </DetailRow>
          <DetailRow label={t("colTarget")}>
            {formatIncentiveTargetSummary(rule, (key, values) => t(key, values))}
          </DetailRow>
          <DetailRow label={t("colReward")}>
            {formatIncentiveRewardSummary(rule, (key, values) => t(key, values))}
          </DetailRow>
          <DetailRow label={t("fields.cumulativePayout")}>
            {rule.payout_mode === "cumulative" ? tPage("yes") : tPage("no")}
          </DetailRow>
          <DetailRow label={t("fields.overridesOthers")}>
            {rule.overrides_others ? tPage("yes") : tPage("no")}
          </DetailRow>
          <DetailRow label={t("fields.priority")}>{rule.priority}</DetailRow>
          <DetailRow label={t("fields.startDate")}>{rule.start_date}</DetailRow>
          <DetailRow label={t("fields.endDate")}>{rule.end_date}</DetailRow>
          <DetailRow label={t("colStatus")}>
            <DpdStatusBadge status={rule.status} />
          </DetailRow>
        </CardContent>
      </Card>

      <Card className="rounded-xl border-border shadow-sm">
        <CardContent className="p-4">
          <p className="mb-2 text-xs font-semibold text-accent">
            {t("fields.tieredTargets")}
          </p>
          {rule.target_mode !== "tiered" || rule.tiers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tPage("tiersEmpty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className={TABLE_HEAD_CLASS}>
                    {t("fields.tierThreshold")}
                  </TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>
                    {t("fields.rewardMode")}
                  </TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>
                    {t("colReward")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rule.tiers.map((tier) => (
                  <TableRow key={tier.id}>
                    <TableCell className="tabular-nums">
                      {tier.threshold_deliveries}
                    </TableCell>
                    <TableCell>{t(`rewardTypes.${tier.reward_mode}`)}</TableCell>
                    <TableCell className="tabular-nums">
                      {tier.reward_mode === "per_delivery"
                        ? `${tier.reward_per_delivery_kwd ?? 0} ${t("perDeliveryShort")}`
                        : (tier.reward_kwd ?? 0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <IncentiveRuleFormSheet
        rule={rule}
        options={scopeOptions}
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) {
            // The rule arrived as a server prop, so the sheet's own query
            // invalidation is not enough to repaint this page.
            router.refresh();
          }
        }}
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
