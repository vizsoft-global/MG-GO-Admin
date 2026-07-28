"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { AppListCard } from "@/components/app/app-list-card";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  defaultEndDate,
  defaultStartDateMonthsAgo,
} from "@/lib/date/kuwait-dates";
import { NewPayoutRunDialog } from "./new-payout-run-dialog";
import { usePayoutRuns } from "./use-payouts";

export function PayoutsPageShell() {
  const t = useTranslations("pages.payouts");
  const router = useRouter();
  const { can } = useAuth();
  const canManage = can("earnings.manage");
  const [startDate, setStartDate] = useState(defaultStartDateMonthsAgo);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [newRunOpen, setNewRunOpen] = useState(false);
  const runsQuery = usePayoutRuns(startDate, endDate);
  const runs = runsQuery.data ?? [];

  const totalDraft = runs.filter((r) => r.status === "draft").length;
  const totalApproved = runs.filter((r) => r.status === "approved").length;
  const totalPaid = runs.filter((r) => r.status === "paid").length;
  const totalKw = runs.reduce((sum, row) => sum + Number(row.total_payable_kwd), 0);

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          canManage ? (
            <Button onClick={() => setNewRunOpen(true)}>{t("newRunTitle")}</Button>
          ) : null
        }
      />

      <KpiGrid
        items={[
          { label: t("kpiDraft"), value: totalDraft },
          { label: t("kpiApproved"), value: totalApproved },
          { label: t("kpiPaid"), value: totalPaid },
          { label: t("kpiTotal"), value: totalKw.toFixed(3) },
          { label: t("periodStart"), value: startDate },
          { label: t("periodEnd"), value: endDate },
        ]}
      />

      <AppListCard>
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-end gap-3 border-b border-border pb-4">
            <div className="space-y-1.5">
              <Label htmlFor="payout-start-filter">{t("periodStart")}</Label>
              <Input
                id="payout-start-filter"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-44 rounded-lg"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payout-end-filter">{t("periodEnd")}</Label>
              <Input
                id="payout-end-filter"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-44 rounded-lg"
              />
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className={TABLE_HEAD_CLASS}>{t("colPeriod")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colDrivers")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colTotalPayable")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colCreated")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => router.push(`/payouts/${row.id}`)}
                >
                  <TableCell className="text-sm">
                    {row.period_start} - {row.period_end}
                  </TableCell>
                  <TableCell className="tabular-nums">{row.total_drivers}</TableCell>
                  <TableCell className="tabular-nums font-medium">
                    {Number(row.total_payable_kwd).toFixed(3)}
                  </TableCell>
                  <TableCell>
                    <StatusPill variant="neutral">{row.status}</StatusPill>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(row.created_at).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </AppListCard>

      {canManage ? (
        <NewPayoutRunDialog open={newRunOpen} onOpenChange={setNewRunOpen} />
      ) : null}
    </AppPage>
  );
}
