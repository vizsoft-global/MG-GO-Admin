"use client";

import { Fragment, useMemo } from "react";
import { TABLE_HEAD_CLASS } from "@/components/app";
import {
  EmptyCell,
  TableNameCell,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import {
  groupBanner,
  groupRows as groupTableRows,
  ListToolbar,
  rowMatches,
  visibleColumnIds,
} from "@/features/roster/table-kit";
import type { PayrollAdjustmentAuditRow } from "./payroll-types";

/**
 * The **manual changes record** — every hand edit and every daily upload, with
 * who, when, the old value, the new value and the reason.
 *
 * It lives on its own because two tabs show it: Combined Payroll today, and
 * Attendance & Orders once the daily upload exists (an upload is a manual change
 * with reason "Daily upload", and the operator has to be able to see it beside
 * the cells it moved). Read-only in both places — the only way to change a cell
 * is through the grid.
 */
export function PayrollManualChangesPanel({
  rows,
  title,
  hint,
  labels,
  prefKey = "payroll.manualChanges",
}: {
  rows: readonly PayrollAdjustmentAuditRow[];
  title: string;
  hint: string;
  prefKey?: string;
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
  const prefs = useTablePrefs(prefKey, columns);
  const matched = rows.filter((row) =>
    rowMatches(prefs.appliedQuery, [
      row.actorName,
      row.driverName,
      row.mgId,
      row.workDate,
      row.reason,
      row.adjustedStatus,
      row.originalStatus,
    ]),
  );
  const groups = groupTableRows(matched, prefs.groupBy, (row) => {
    if (prefs.groupBy === "who") return row.actorName;
    if (prefs.groupBy === "rider") return row.driverName;
    return "";
  });
  const ids = visibleColumnIds(prefs);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-4 py-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
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
                <th key={id} className={TABLE_HEAD_CLASS}>
                  {columns.find((column) => column.id === id)?.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matched.length === 0 ? (
              <tr>
                <td
                  colSpan={Math.max(ids.length, 1)}
                  className="px-3 py-6 text-center text-xs text-muted-foreground"
                >
                  {labels.empty}
                </td>
              </tr>
            ) : (
              groups.map((group) => (
                <Fragment key={group.key}>
                  {group.label ? (
                    <tr>
                      <td
                        colSpan={ids.length}
                        className="bg-muted/40 px-2 py-1 text-xs font-semibold"
                      >
                        {groupBanner(group.label, group.rows.length)}
                      </td>
                    </tr>
                  ) : null}
                  {group.rows.map((row) => (
                    <tr key={row.id} className="border-b border-border/60">
                      {ids.map((id) => (
                        <td key={id} className="px-2 py-1.5">
                          {id === "when" ? row.adjustedAt : null}
                          {id === "who" ? <TableNameCell name={row.actorName} /> : null}
                          {id === "rider" ? (
                            <TableNameCell
                              name={row.driverName ? `${row.driverName} · ${row.mgId}` : row.mgId}
                            />
                          ) : null}
                          {id === "day" ? row.workDate : null}
                          {id === "original" ? (
                            row.originalStatus ? row.originalStatus : <EmptyCell />
                          ) : null}
                          {id === "adjusted" ? (
                            `${row.adjustedStatus}${
                              row.adjustedHours != null ? ` · ${row.adjustedHours}h` : ""
                            }`
                          ) : null}
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
