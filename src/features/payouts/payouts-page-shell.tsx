"use client";

import { useMemo, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { AppListCard } from "@/components/app/app-list-card";
import {
  AppListControls,
  GroupedSections,
  fieldSearchMatch,
  groupRows,
  useListControlLabels,
  useListViewPrefs,
} from "@/components/app/app-list-controls";
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
import type { PayoutRunRow } from "./types";

export function PayoutsPageShell() {
  const t = useTranslations("pages.payouts");
  const labels = useListControlLabels();
  const router = useRouter();
  const { can } = useAuth();
  const canManage = can("earnings.manage");
  const [startDate, setStartDate] = useState(defaultStartDateMonthsAgo);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [search, setSearch] = useState("");
  const [newRunOpen, setNewRunOpen] = useState(false);
  const { prefs, update } = useListViewPrefs("payouts");
  const runsQuery = usePayoutRuns(startDate, endDate);
  const runs = runsQuery.data ?? [];

  const filtered = useMemo(
    () =>
      runs.filter((row) =>
        fieldSearchMatch(row, search, {
          name: (item) => item.period_start,
          status: (item) => item.status,
          employee_id: (item) => item.id,
        }),
      ),
    [runs, search],
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
        <p className="text-sm font-semibold">
          {row.period_start} - {row.period_end}
        </p>
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
        <div className="space-y-3 p-4">
          <AppListControls
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder={t("searchPlaceholder")}
            clearSearchLabel={labels.clearSearch}
            groupByOptions={[labels.group.none, labels.group.status]}
            groupBy={prefs.groupBy}
            onGroupByChange={(value) => update({ groupBy: value })}
            groupByLabel={labels.groupBy}
            viewMode={prefs.viewMode}
            onViewModeChange={(value) => update({ viewMode: value })}
            tableViewLabel={labels.viewTable}
            cardsViewLabel={labels.viewCards}
            filterSlot={
              <>
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
              </>
            }
          />

          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("emptyFiltered")}</p>
          ) : prefs.viewMode === "cards" ? (
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
