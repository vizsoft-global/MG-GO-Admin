"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2 } from "lucide-react";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  FlatListPager,
  GroupTableHeaderRow,
  fieldSearchMatch,
  groupRows,
  useGroupedListView,
} from "@/components/app/app-list-controls";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import {
  EmptyCell,
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { StatusPill } from "@/components/dashboard/status-pill";
import { useAuth } from "@/contexts/auth-context";
import { FleetRequestDialog } from "@/features/fuel/fleet-request-dialog";
import type { FleetRequestListRow } from "@/features/fuel/fleet-request-types";
import { useFleetRequests } from "@/features/fuel/use-fleet-requests";
import { toKuwaitYmd } from "@/features/fleet/fleet-labels";
import { requestStatusLabelKey, requestStatusVariant } from "@/features/requests/request-status-utils";
import { formatKuwaitDayLabel } from "@/lib/date/kuwait-dates";

function typeLabel(
  type: FleetRequestListRow["request_type"],
  tQueue: (key: "typeFuel" | "typeRefund" | "typeAsset") => string,
): string {
  switch (type) {
    case "fuel":
      return tQueue("typeFuel");
    case "fuel_refund":
      return tQueue("typeRefund");
    case "asset":
      return tQueue("typeAsset");
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

export function FleetRjPageShell() {
  const t = useTranslations("pages.fleetRj");
  const tHub = useTranslations("pages.fleetHub.hub");
  const tQueue = useTranslations("pages.fleetFuelQueue");
  const statusT = useTranslations("pages.requests.status");
  const { can } = useAuth();
  const canFuel = can("fuel.view") || can("fuel_requests.view");
  const canRefund = can("fuel.view") || can("fuel_refunds.view");
  const canAsset = can("asset_requests.view");
  const fuel = useFleetRequests("fuel");
  const refund = useFleetRequests("fuel_refund");
  const asset = useFleetRequests("asset");
  const [selected, setSelected] = useState<FleetRequestListRow | null>(null);
  const columns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "code", label: tQueue("colRequestId"), locked: true },
      { id: "type", label: t("colType") },
      { id: "driver", label: tQueue("colDriver"), locked: true },
      { id: "plate", label: tQueue("colPlate") },
      { id: "status", label: tQueue("colStatus"), categorical: true },
      { id: "date", label: tQueue("colDate") },
      { id: "actions", label: tQueue("colActions"), locked: true },
    ],
    [t, tQueue],
  );
  const prefs = useTablePrefs("fleet-rj", columns);

  const rows = useMemo(() => {
    const listed: FleetRequestListRow[] = [];
    if (canFuel) listed.push(...(fuel.data?.rows ?? []));
    if (canRefund) listed.push(...(refund.data?.rows ?? []));
    if (canAsset) listed.push(...(asset.data?.rows ?? []));
    return listed
      .filter((row) => row.status === "rejected")
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [asset.data, canAsset, canFuel, canRefund, fuel.data, refund.data]);

  const filtered = useMemo(
    () =>
      rows.filter((row) =>
        fieldSearchMatch(row, prefs.appliedQuery, {
          name: (item) => item.driver_name,
          employee_id: (item) => item.employee_id,
          plate: (item) => item.plate,
          status: (item) => item.status,
        }),
      ),
    [prefs.appliedQuery, rows],
  );
  const grouped = useMemo(
    () =>
      groupRows(
        filtered,
        prefs.groupBy,
        {
          status: (row) => row.request_type,
        },
        {},
        "—",
      ),
    [filtered, prefs.groupBy],
  );
  const listView = useGroupedListView(
    grouped,
    prefs.groupBy !== "none",
    `${prefs.groupBy}\u0001${prefs.appliedQuery}`,
  );
  const shownColumns = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));

  const isPending =
    (canFuel && fuel.data === undefined && fuel.isPending) ||
    (canRefund && refund.data === undefined && refund.isPending) ||
    (canAsset && asset.data === undefined && asset.isPending);

  return (
    <AppPage>
      <AppPageHeader
        breadcrumbs={[{ label: tHub("breadcrumb"), href: "/fleet" }, { label: t("breadcrumb") }]}
        title={t("title")}
        description={t("subtitle")}
      />
      <AppListCard>
        {isPending ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <AppEmptyState title={t("emptyTitle")} description={t("emptyHint")} />
        ) : (
          <>
          <FlatListPager pager={listView.flatPager} onStep={listView.stepFlat} />
          <AppDataTable
            toolbar={
              <TableToolbar
                prefs={prefs}
                entity={t("title")}
                columns={columns}
                rowKind="dynamic"
                filteredCount={filtered.length}
                totalCount={rows.length}
              />
            }
            columns={shownColumns.map((column) => ({
              id: column.id,
              label: column.label,
              className: column.id === "actions" ? "w-[1%]" : undefined,
            }))}
            empty={filtered.length === 0 ? <AppDataTableEmpty>{tQueue("emptyFilters")}</AppDataTableEmpty> : null}
          >
            {listView.sections.flatMap((section) => [
              section.showHeader ? (
                <GroupTableHeaderRow
                  key={`g-${section.key}`}
                  colSpan={shownColumns.length}
                  label={section.label}
                  total={section.total}
                  open={section.open}
                  page={section.page}
                  showPager={section.showPager}
                  onToggle={() => listView.toggle(section.key)}
                  onStep={(dir) => listView.step(section.key, dir)}
                />
              ) : null,
              ...section.visibleRows.map((row) => (
              <AppDataTableRow
                key={row.id}
                className="cursor-pointer"
                onClick={() => setSelected(row)}
              >
                {shownColumns.map((column) => {
                  switch (column.id) {
                    case "code":
                      return (
                        <TableCell key={column.id} className="whitespace-nowrap font-medium">
                          {row.request_code || <EmptyCell />}
                        </TableCell>
                      );
                    case "type":
                      return (
                        <TableCell key={column.id} className="whitespace-nowrap">
                          {typeLabel(row.request_type, tQueue)}
                        </TableCell>
                      );
                    case "driver":
                      return (
                        <TableCell key={column.id} className="whitespace-nowrap">
                          <TableNameCell name={row.driver_name} />
                          {row.employee_id ? (
                            <p className="text-xs text-muted-foreground">{row.employee_id}</p>
                          ) : null}
                        </TableCell>
                      );
                    case "plate":
                      return (
                        <TableCell key={column.id} className="whitespace-nowrap">
                          {row.plate ? row.plate : <EmptyCell />}
                        </TableCell>
                      );
                    case "status":
                      return (
                        <TableCell key={column.id}>
                          <StatusPill dot variant={requestStatusVariant(row.status)}>
                            {statusT(requestStatusLabelKey(row.status) as "pending")}
                          </StatusPill>
                        </TableCell>
                      );
                    case "date":
                      return (
                        <TableCell key={column.id} className="whitespace-nowrap">
                          {formatKuwaitDayLabel(toKuwaitYmd(row.created_at))}
                        </TableCell>
                      );
                    case "actions":
                      return (
                        <TableCell key={column.id} className="w-[1%] whitespace-nowrap">
                          <button
                            type="button"
                            className="inline-flex h-9 items-center gap-1 text-primary hover:bg-primary/10"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelected(row);
                            }}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            {tQueue("open")}
                          </button>
                        </TableCell>
                      );
                    default:
                      return null;
                  }
                })}
              </AppDataTableRow>
              )),
            ])}
          </AppDataTable>
          </>
        )}
      </AppListCard>
      <FleetRequestDialog
        open={Boolean(selected)}
        type={selected?.request_type === "fuel_refund" ? "fuel_refund" : selected?.request_type === "asset" ? "asset" : "fuel"}
        row={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </AppPage>
  );
}
