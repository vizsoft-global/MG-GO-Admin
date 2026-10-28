"use client";

import { useMemo, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { AppListCard } from "@/components/app/app-list-card";
import {
  GroupedSections,
  fieldSearchMatch,
  groupRows,
} from "@/components/app/app-list-controls";
import {
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
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
import type { PayoutRunRow } from "./types";

export function PayoutsPageShell() {
  const t = useTranslations("pages.payouts");
  const toolbarColumns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "period", label: t("colPeriod"), locked: true },
      { id: "drivers", label: t("colDrivers") },
      { id: "payable", label: t("colTotalPayable") },
      { id: "status", label: t("colStatus"), categorical: true },
      { id: "created", label: t("colCreated") },
    ],
    [t],
  );
  const prefs = useTablePrefs("payouts", toolbarColumns);
  const router = useRouter();
  const { can } = useAuth();
  const canManage = can("earnings.manage");
  const [startDate, setStartDate] = useState(defaultStartDateMonthsAgo);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [newRunOpen, setNewRunOpen] = useState(false);
  const runsQuery = usePayoutRuns(startDate, endDate);
  const runs = runsQuery.data ?? [];

  const filtered = useMemo(
    () =>
      runs.filter((row) =>
        fieldSearchMatch(row, prefs.appliedQuery, {
          name: (item) => item.period_start,
          status: (item) => item.status,
          employee_id: (item) => item.id,
        }),
      ),
    [prefs.appliedQuery, runs],
  );
  const grouped = useMemo(
    () =>
      groupRows(
        filtered,
        prefs.groupBy,
        {
          status: (row) => row.status,
        },
        {},
        "—",
      ),
    [filtered, prefs.groupBy],
  );

  const totalDraft = runs.filter((r) => r.status === "draft").length;
  const totalApproved = runs.filter((r) => r.status === "approved").length;
  const totalPaid = runs.filter((r) => r.status === "paid").length;
  const totalKw = runs.reduce((sum, row) => sum + Number(row.total_payable_kwd), 0);

  function renderRun(row: PayoutRunRow) {
    return (
      <button
        type="button"
        key={row.id}
        className="w-full rounded-xl border border-border bg-card p-4 text-start shadow-sm hover:bg-muted/40"
        onClick={() => router.push(`/payouts/${row.id}`)}
      >
        <TableNameCell name={`${row.period_start} - ${row.period_end}`} />
        <p className="mt-1 text-xs text-muted-foreground">
          {row.total_drivers} · {Number(row.total_payable_kwd).toFixed(3)}
        </p>
        <div className="mt-2">
          <StatusPill variant="neutral">{row.status}</StatusPill>
        </div>
      </button>
    );
  }

  return (
    <AppPage>
      <AppPageHeader title={t("title")} description={t("subtitle")} />

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

      <AppListCard
        toolbar={
          <>
            <TableToolbar
              prefs={prefs}
              entity={t("title")}
              columns={toolbarColumns}
              rowKind="dynamic"
              entityList
              filteredCount={filtered.length}
              totalCount={runs.length}
              onAdd={canManage ? () => setNewRunOpen(true) : undefined}
              addLabel={t("newRunTitle")}
            />
            <div className="flex flex-wrap gap-2 px-4 pb-3">
              <div className="space-y-1">
                <Label htmlFor="payout-start-filter" className="sr-only">
                  {t("periodStart")}
                </Label>
                <Input
                  id="payout-start-filter"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-9 w-40 rounded-lg"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="payout-end-filter" className="sr-only">
                  {t("periodEnd")}
                </Label>
                <Input
                  id="payout-end-filter"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-9 w-40 rounded-lg"
                />
              </div>
            </div>
          </>
        }
      >
        <div className="space-y-3 p-4">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("emptyFiltered")}</p>
          ) : prefs.view === "grid" ? (
            <GroupedSections groups={grouped}>
              {(rows) => (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {rows.map(renderRun)}
                </div>
              )}
            </GroupedSections>
          ) : (
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
                {grouped.flatMap((group) => [
                  ...(prefs.groupBy !== "none"
                    ? [
                        <TableRow key={`g-${group.key}`} className="bg-muted/40 hover:bg-muted/40">
                          <TableCell colSpan={5} className="text-xs font-semibold">
                            {group.label} · {group.rows.length}
                          </TableCell>
                        </TableRow>,
                      ]
                    : []),
                  ...group.rows.map((row) => (
                    <TableRow
                      key={row.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => router.push(`/payouts/${row.id}`)}
                    >
                      <TableCell className="text-sm">
                        <TableNameCell name={`${row.period_start} - ${row.period_end}`} />
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
                  )),
                ])}
              </TableBody>
            </Table>
          )}
        </div>
      </AppListCard>

      {canManage ? (
        <NewPayoutRunDialog open={newRunOpen} onOpenChange={setNewRunOpen} />
      ) : null}
    </AppPage>
  );
}
