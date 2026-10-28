"use client";

import { Fragment, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Banknote,
  CalendarDays,
  CircleDollarSign,
  FileText,
  Fuel,
  Inbox,
  Shirt,
  Siren,
  Stethoscope,
} from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { TABLE_HEAD_CLASS } from "@/components/app";
import { EmptyCell, TableNameCell, useTablePrefs, type TableToolbarColumn } from "@/components/app/table-toolbar";
import { groupBanner, groupRows, ListToolbar, rowMatches, visibleColumnIds } from "@/features/roster/table-kit";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  formatPayrollPct,
  type PayrollMonthMeta,
  type PayrollTileKey,
  type PayrollUiStatus,
  type RequestKpis,
} from "./payroll-formulas";
import { ApprovalWorkflowPanel } from "./approval-workflow-panel";
import { exportRequestsCsv } from "./payroll-csv";
import type { PayrollRequestRow } from "./payroll-types";

const TILES: Array<{
  key: PayrollTileKey;
  icon: typeof CalendarDays;
  deptKey: "operations" | "hrClinic" | "safetyLegal" | "fleet" | "finance" | "hr" | "payroll";
}> = [
  { key: "leave", icon: CalendarDays, deptKey: "operations" },
  { key: "sick", icon: Stethoscope, deptKey: "hrClinic" },
  { key: "accident", icon: Siren, deptKey: "safetyLegal" },
  { key: "asset", icon: Shirt, deptKey: "fleet" },
  { key: "fuel", icon: Fuel, deptKey: "fleet" },
  { key: "loan", icon: Banknote, deptKey: "finance" },
  { key: "document", icon: FileText, deptKey: "hr" },
  { key: "salary_justification", icon: CircleDollarSign, deptKey: "payroll" },
];

const STATUSES: Array<PayrollUiStatus | "all"> = [
  "all",
  "pending",
  "under_review",
  "approved",
  "rejected",
];

function statusPill(status: PayrollUiStatus): string {
  switch (status) {
    case "pending":
      return "bg-amber-100 text-amber-800";
    case "under_review":
      return "bg-sky-100 text-sky-800";
    case "approved":
      return "bg-emerald-100 text-emerald-800";
    case "rejected":
      return "bg-red-100 text-red-700";
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

export function RequestsTab({
  month,
  kpis,
  requests,
  workflow,
  canExport,
}: {
  month: PayrollMonthMeta;
  kpis: RequestKpis;
  requests: readonly PayrollRequestRow[];
  workflow: { awaitingAction: number; requestsPerRider: number };
  canExport: boolean;
}) {
  const t = useTranslations("pages.payroll");
  const [tile, setTile] = useState<PayrollTileKey | "all">("all");
  const [status, setStatus] = useState<PayrollUiStatus | "all">("all");

  const requestColumns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "code", label: t("cols.requestId"), locked: true },
      { id: "rider", label: t("cols.rider"), locked: true },
      { id: "id", label: t("cols.id") },
      { id: "type", label: t("cols.type"), categorical: true },
      { id: "day", label: t("cols.day") },
      { id: "zone", label: t("cols.zone"), categorical: true },
      { id: "partner", label: t("cols.partner"), categorical: true },
      { id: "dept", label: t("cols.dept"), categorical: true },
      { id: "status", label: t("cols.status"), categorical: true },
    ],
    [t],
  );
  const requestPrefs = useTablePrefs("payroll.requests", requestColumns);
  const list = useMemo(() => {
    return requests.filter((r) => {
      if (tile !== "all" && r.tile !== tile) return false;
      if (status !== "all" && r.uiStatus !== status) return false;
      return rowMatches(requestPrefs.appliedQuery, [r.code, r.riderName, r.riderCode, r.zone, r.partner, r.reviewingDept, r.day]);
    });
  }, [requestPrefs.appliedQuery, requests, status, tile]);

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-xs leading-5 shadow-sm">
        <b>{t("requestsBannerTitle")}</b> {t("requestsBannerBody")}
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <KpiCard compact label={t("reqKpi.total")} value={kpis.total} icon={Inbox} />
        <KpiCard compact label={t("reqKpi.pending")} value={kpis.pending} accent="warning" />
        <KpiCard compact label={t("reqKpi.underReview")} value={kpis.underReview} accent="primary" />
        <KpiCard compact label={t("reqKpi.approved")} value={kpis.approved} accent="success" />
        <KpiCard compact label={t("reqKpi.rejected")} value={kpis.rejected} accent="danger" />
        <KpiCard
          compact
          label={t("reqKpi.rate")}
          value={formatPayrollPct(kpis.approvalRate)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {TILES.map((item) => {
          const Icon = item.icon;
          const open = requests.filter(
            (r) => r.tile === item.key && (r.uiStatus === "pending" || r.uiStatus === "under_review"),
          ).length;
          const total = requests.filter((r) => r.tile === item.key).length;
          const on = tile === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setTile(on ? "all" : item.key)}
              className={cn(
                "relative rounded-xl border p-3 text-start shadow-sm transition-colors",
                on
                  ? "border-emerald-500 bg-emerald-100 text-emerald-900 ring-1 ring-emerald-400/50"
                  : "border-border bg-card hover:bg-muted/30",
              )}
            >
              {open > 0 ? (
                <span className="absolute end-2 top-2 rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-extrabold text-white">
                  {open}
                </span>
              ) : null}
              <span
                className={cn(
                  "mb-2 inline-flex size-9 items-center justify-center rounded-lg",
                  on ? "bg-emerald-200 text-emerald-900" : "bg-muted text-muted-foreground",
                )}
              >
                <Icon className="size-4" />
              </span>
              <p className="text-xs font-bold">{t(`tiles.${item.key}`)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t(`tileDept.${item.deptKey}`)} · {total}
              </p>
            </button>
          );
        })}
      </div>
      <div className="grid gap-2 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] lg:items-stretch">
        <div className="flex h-full flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">
                {t("queueTitle")}
                {tile !== "all" ? ` · ${t(`tiles.${tile}`)}` : ""}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t("queueSub", { count: list.length, month: month.label })}
              </p>
            </div>
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {STATUSES.map((s) => (
              <ToggleChip key={s} selected={status === s} onClick={() => setStatus(s)}>
                {s === "all" ? t("status.all") : t(`status.${s}`)}
              </ToggleChip>
            ))}
          </div>
          <ListToolbar
            prefs={requestPrefs}
            entity={t("queueTitle")}
            columns={requestColumns}
            rowKind="dynamic"
            filteredCount={list.length}
            totalCount={requests.length}
            onExport={
              canExport
                ? () =>
                    exportRequestsCsv(
                      month.key,
                      list,
                      (key) => t(`tiles.${key}`),
                      (s) => t(`status.${s}`),
                    )
                : undefined
            }
          />
          <RequestRows columns={requestColumns} prefs={requestPrefs} rows={list} empty={t("emptyRequests")} statusLabel={(row) => t(`status.${row.uiStatus}`)} typeLabel={(row) => t(`tiles.${row.tile}`)} />
        </div>
        <ApprovalWorkflowPanel
          awaitingAction={workflow.awaitingAction}
          requestsPerRider={workflow.requestsPerRider}
        />
      </div>
    </div>
  );
}

function RequestRows({
  columns,
  prefs,
  rows,
  empty,
  statusLabel,
  typeLabel,
}: {
  columns: TableToolbarColumn[];
  prefs: ReturnType<typeof useTablePrefs>;
  rows: readonly PayrollRequestRow[];
  empty: string;
  statusLabel: (row: PayrollRequestRow) => string;
  typeLabel: (row: PayrollRequestRow) => string;
}) {
  const ids = visibleColumnIds(prefs);
  const groups = groupRows(rows, prefs.groupBy, (row) => {
    if (prefs.groupBy === "type") return typeLabel(row);
    if (prefs.groupBy === "zone") return row.zone;
    if (prefs.groupBy === "partner") return row.partner;
    if (prefs.groupBy === "dept") return row.reviewingDept;
    if (prefs.groupBy === "status") return statusLabel(row);
    return "";
  });
  return (
    <div className="max-h-[min(480px,46dvh)] overflow-auto">
      <table className="w-full min-w-[1100px] border-collapse text-xs">
        <thead className="sticky top-0 bg-card">
          <tr>
            {ids.map((id) => (
              <th key={id} className={cn(TABLE_HEAD_CLASS, "px-2 py-2")}>
                {columns.find((column) => column.id === id)?.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={Math.max(ids.length, 1)} className="px-3 py-8 text-center text-xs text-muted-foreground">
                {empty}
              </td>
            </tr>
          ) : (
            groups.map((group) => (
              <Fragment key={group.key}>
                {group.label ? (
                  <tr>
                    <td colSpan={ids.length} className="bg-muted/40 px-2 py-1 text-xs font-semibold">
                      {groupBanner(group.label, group.rows.length)}
                    </td>
                  </tr>
                ) : null}
                {group.rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/60 hover:bg-muted/30">
                    {ids.map((id) => (
                      <td key={id} className="px-2 py-1.5">
                        {id === "code" ? (
                          <Link href={`/requests/${row.id}`} className="font-semibold text-primary hover:bg-primary/10">
                            {row.code}
                          </Link>
                        ) : null}
                        {id === "rider" ? <TableNameCell name={row.riderName} /> : null}
                        {id === "id" ? (row.riderCode ? row.riderCode : <EmptyCell />) : null}
                        {id === "type" ? typeLabel(row) : null}
                        {id === "day" ? (row.day ? row.day : <EmptyCell />) : null}
                        {id === "zone" ? (row.zone ? row.zone : <EmptyCell />) : null}
                        {id === "partner" ? (row.partner ? row.partner : <EmptyCell />) : null}
                        {id === "dept" ? (row.reviewingDept ? row.reviewingDept : <EmptyCell />) : null}
                        {id === "status" ? (
                          <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-bold", statusPill(row.uiStatus))}>
                            {statusLabel(row)}
                          </span>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
