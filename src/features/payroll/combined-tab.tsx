"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { TABLE_HEAD_CLASS } from "@/components/app";
import { EmptyCell, TableNameCell, useTablePrefs, type TableToolbarColumn } from "@/components/app/table-toolbar";
import { groupBanner, groupRows as groupTableRows, ListToolbar, rowMatches, visibleColumnIds } from "@/features/roster/table-kit";
import { GroupedSections, groupRows } from "@/components/app/app-list-controls";
import { payrollRiderMatchesSearch, type PayrollPeriod } from "./payroll-formulas";
import { PayrollListToolbar, usePayrollListPrefs } from "./payroll-list-toolbar";
import { PayrollDayGrid, PayrollLegend } from "./payroll-grid";
import { exportCombinedPayrollCsv } from "./payroll-csv";
import { configByKey, exportLabelsFromConfig, hiddenSetFor } from "./payroll-column-config";
import { PayrollColumnsMenu } from "./payroll-heading";
import { usePayrollAdjustmentAudit, usePayrollColumnConfig } from "./use-payroll";
import type { PayrollRiderRow } from "./payroll-types";

export function CombinedPayrollTab({
  month,
  riders,
  canExport,
  canManage,
  today,
}: {
  month: PayrollPeriod;
  riders: readonly PayrollRiderRow[];
  canExport: boolean;
  canManage: boolean;
  /** Kuwait date the page calls today; drives the Rider Status column. */
  today: string;
}) {
  const t = useTranslations("pages.payroll");
  const [search, setSearch] = useState("");
  const { prefs } = usePayrollListPrefs("payroll-combined");
  const audit = usePayrollAdjustmentAudit({ from: month.from, to: month.to });
  const headings = usePayrollColumnConfig();
  const headingConfig = useMemo(() => configByKey(headings.data), [headings.data]);

  const searched = useMemo(
    () => riders.filter((r) => payrollRiderMatchesSearch(r, search)),
    [riders, search],
  );
  const grouped = useMemo(
    () =>
      groupRows(
        searched,
        prefs.groupBy,
        {
          zone: (row) => row.zone,
          partner: (row) => row.partner,
          status: (row) => row.status,
        },
        {},
        "—",
      ),
    [prefs.groupBy, searched],
  );

  const fallbackLabel = useCallback((key: string) => t(`riderCols.${key}`), [t]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-xs leading-5 shadow-sm">
          <b>{t("combinedBannerTitle")}</b> {t("combinedBannerBody")}
        </div>
        <PayrollColumnsMenu
          view="combined"
          config={headingConfig}
          fallbackLabel={fallbackLabel}
          canManage={canManage}
        />
      </div>
      <PayrollListToolbar prefKey="payroll-combined" search={search} onSearchChange={setSearch} />
      <GroupedSections groups={grouped}>
        {(rows, group) => (
          <PayrollDayGrid
            key={group.key}
            dates={month.dates}
            rows={rows}
            today={today}
            empty={t("emptyRiders")}
            exportLabel={t("downloadTable")}
            headingConfig={headingConfig}
            headingManage={canManage}
            identityEdit={canManage}
            onExport={(visible) => {
              if (canExport) {
                exportCombinedPayrollCsv(month.key, month.dates, visible, {
                  labels: exportLabelsFromConfig(headingConfig, fallbackLabel),
                  hidden: hiddenSetFor("combined", headingConfig),
                  today,
                });
              }
            }}
            footer={t("tableFootRange", {
              shown: rows.length,
              total: riders.length,
              range: month.label,
            })}
          />
        )}
      </GroupedSections>
      <PayrollLegend riders={searched} />
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-4 py-2">
          <h3 className="text-sm font-semibold">{t("manualChanges.title")}</h3>
          <p className="text-xs text-muted-foreground">{t("manualChanges.hint")}</p>
        </div>
        <ManualChangesTable
          rows={audit.data ?? []}
          labels={{
            when: t("manualChanges.when"),
            who: t("manualChanges.who"),
            rider: t("manualChanges.rider"),
            day: t("manualChanges.day"),
            original: t("manualChanges.original"),
            adjusted: t("manualChanges.adjusted"),
            reason: t("manualChanges.reason"),
            empty: t("manualChanges.empty"),
            entity: t("manualChanges.title"),
          }}
        />
      </div>
    </div>
  );
}

type ManualChangeRow = {
  id: string;
  adjustedAt: string;
  actorName: string;
  driverName: string;
  mgId: string;
  workDate: string;
  originalStatus: string | null;
  adjustedStatus: string;
  adjustedHours: number | null;
  reason: string;
};

function ManualChangesTable({
  rows,
  labels,
}: {
  rows: readonly ManualChangeRow[];
  labels: {
    when: string;
    who: string;
    rider: string;
    day: string;
    original: string;
    adjusted: string;
    reason: string;
    empty: string;
    entity: string;
  };
}) {
  const columns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "when", label: labels.when },
      { id: "who", label: labels.who, categorical: true },
      { id: "rider", label: labels.rider, locked: true, categorical: true },
      { id: "day", label: labels.day },
      { id: "original", label: labels.original },
      { id: "adjusted", label: labels.adjusted },
      { id: "reason", label: labels.reason },
    ],
    [labels.adjusted, labels.day, labels.original, labels.reason, labels.rider, labels.when, labels.who],
  );
  const prefs = useTablePrefs("payroll.manualChanges", columns);
  const matched = rows.filter((row) =>
    rowMatches(prefs.appliedQuery, [row.actorName, row.driverName, row.mgId, row.workDate, row.reason, row.adjustedStatus, row.originalStatus]),
  );
  const groups = groupTableRows(matched, prefs.groupBy, (row) => {
    if (prefs.groupBy === "who") return row.actorName;
    if (prefs.groupBy === "rider") return row.driverName;
    return "";
  });
  const ids = visibleColumnIds(prefs);
  return (
    <div>
      <ListToolbar
        prefs={prefs}
        entity={labels.entity}
        columns={columns}
        rowKind="dynamic"
        filteredCount={matched.length}
        totalCount={rows.length}
      />
      <div className="max-h-[min(240px,28dvh)] overflow-auto">
        <table className="w-max min-w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-card">
            <tr>
              {ids.map((id) => (
                <th key={id} className={TABLE_HEAD_CLASS}>{columns.find((column) => column.id === id)?.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matched.length === 0 ? (
              <tr>
                <td colSpan={Math.max(ids.length, 1)} className="px-3 py-6 text-center text-xs text-muted-foreground">{labels.empty}</td>
              </tr>
            ) : (
              groups.map((group) => (
                <Fragment key={group.key}>
                  {group.label ? (
                    <tr>
                      <td colSpan={ids.length} className="bg-muted/40 px-2 py-1 text-xs font-semibold">{groupBanner(group.label, group.rows.length)}</td>
                    </tr>
                  ) : null}
                  {group.rows.map((row) => (
                    <tr key={row.id} className="border-b border-border/60">
                      {ids.map((id) => (
                        <td key={id} className="px-2 py-1.5">
                          {id === "when" ? row.adjustedAt : null}
                          {id === "who" ? <TableNameCell name={row.actorName} /> : null}
                          {id === "rider" ? <TableNameCell name={row.driverName ? `${row.driverName} · ${row.mgId}` : row.mgId} /> : null}
                          {id === "day" ? row.workDate : null}
                          {id === "original" ? (row.originalStatus ? row.originalStatus : <EmptyCell />) : null}
                          {id === "adjusted" ? `${row.adjustedStatus}${row.adjustedHours != null ? ` · ${row.adjustedHours}h` : ""}` : null}
                          {id === "reason" ? (row.reason ? row.reason : <EmptyCell />) : null}
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
    </div>
  );
}
