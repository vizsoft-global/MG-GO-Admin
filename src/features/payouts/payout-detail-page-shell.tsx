"use client";

import { useMemo, useState } from "react";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AppPage } from "@/components/app/app-page";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/dashboard/status-pill";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/auth-context";
import { useApprovePayoutRun, useMarkPayoutRunPaid, usePayoutRunDetail, useVoidPayoutRun } from "./use-payouts";
import { PayoutLineDetailDialog } from "./payout-line-detail-dialog";
import type { DriverPayoutLine } from "./types";

export function PayoutDetailPageShell({ runId }: { runId: string }) {
  const t = useTranslations("pages.payouts");
  const { can } = useAuth();
  const canManage = can("earnings.manage");
  const detailQuery = usePayoutRunDetail(runId);
  const approve = useApprovePayoutRun();
  const markPaid = useMarkPayoutRunPaid();
  const voidRun = useVoidPayoutRun();
  const [selectedLine, setSelectedLine] = useState<DriverPayoutLine | null>(null);

  const run = (detailQuery.data?.run ?? {}) as Record<string, unknown>;
  const lines = (detailQuery.data?.lines ?? []) as DriverPayoutLine[];
  const status = String(run.status ?? "draft");

  const totals = useMemo(() => {
    return lines.reduce(
      (acc, line) => {
        acc.deliveries += Number(line.delivery_count);
        acc.net += Number(line.net_payable_kwd);
        return acc;
      },
      { deliveries: 0, net: 0 },
    );
  }, [lines]);

  const onApprove = async () => {
    const result = await approve.mutateAsync(runId);
    if ("error" in result) {
      toast.error(t("approveFailed"), { description: result.error });
      return;
    }
    toast.success(t("approveSuccess"));
    void detailQuery.refetch();
  };

  const onMarkPaid = async () => {
    const result = await markPaid.mutateAsync({ id: runId });
    if ("error" in result) {
      toast.error(t("markPaidFailed"), { description: result.error });
      return;
    }
    toast.success(t("markPaidSuccess"));
    void detailQuery.refetch();
  };

  const onVoid = async () => {
    const result = await voidRun.mutateAsync({ id: runId });
    if ("error" in result) {
      toast.error(t("voidFailed"), { description: result.error });
      return;
    }
    toast.success(t("voidSuccess"));
    void detailQuery.refetch();
  };

  return (
    <AppPage>
      <div className="flex items-center justify-between">
        <div>
          <Link href="/payouts" className="text-sm text-muted-foreground hover:underline">
            {t("backToList")}
          </Link>
          <h1 className="mt-1 text-lg font-semibold">
            {t("runDetailTitle")} #{runId.slice(0, 8)}
          </h1>
          <p className="text-sm text-muted-foreground">
            {String(run.period_start ?? "—")} - {String(run.period_end ?? "—")}
          </p>
        </div>
        {canManage ? (
          <div className="flex items-center gap-2">
            <StatusPill variant="neutral">{status}</StatusPill>
            {status === "draft" ? <Button onClick={onApprove}>{t("approveRun")}</Button> : null}
            {status === "approved" ? <Button onClick={onMarkPaid}>{t("markPaid")}</Button> : null}
            {status !== "voided" ? (
              <Button variant="outline" onClick={onVoid}>
                {t("voidRun")}
              </Button>
            ) : null}
          </div>
        ) : (
          <StatusPill variant="neutral">{status}</StatusPill>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">{t("colDrivers")}</p>
          <p className="text-lg font-semibold tabular-nums">{lines.length}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">{t("colDeliveries")}</p>
          <p className="text-lg font-semibold tabular-nums">{totals.deliveries}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">{t("colTotalPayable")}</p>
          <p className="text-lg font-semibold tabular-nums">{totals.net.toFixed(3)}</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-3">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead className={TABLE_HEAD_CLASS}>{t("colDriver")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colDeliveries")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colIncentive")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colTotalPayable")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow
                key={line.id}
                className="cursor-pointer hover:bg-muted/40"
                onClick={() => setSelectedLine(line)}
              >
                <TableCell>
                  <div>
                    <p className="font-medium">{line.driver_name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{line.driver_code}</p>
                  </div>
                </TableCell>
                <TableCell className="tabular-nums">{line.delivery_count}</TableCell>
                <TableCell className="tabular-nums">{line.incentive_kwd}</TableCell>
                <TableCell className="tabular-nums font-medium">{line.net_payable_kwd}</TableCell>
                <TableCell>
                  <StatusPill variant="neutral">{line.status}</StatusPill>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <PayoutLineDetailDialog
        open={Boolean(selectedLine)}
        onOpenChange={(open) => !open && setSelectedLine(null)}
        line={selectedLine}
      />
    </AppPage>
  );
}
