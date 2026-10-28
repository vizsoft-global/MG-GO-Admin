"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { AppListCard } from "@/components/app";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { AppEmptyState } from "@/components/app/app-empty-state";
import {
  EmptyCell,
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  GroupTableHeaderRow,
  groupRows,
  useGroupedListView,
} from "@/components/app/app-list-controls";
import { ProjectBadge } from "@/features/fleet/fleet-badges";
import { isDriverProjectKey } from "@/features/fleet/fleet-labels";
import { AssetsFleetKpiStrip } from "./assets-fleet-kpi-strip";
import { AssetAssignmentDialog } from "./asset-assignment-dialog";
import { useFleetAssetAssignments, useFleetAssetKpis } from "./use-assets";

export function AssetsAssignmentsPanel() {
  const t = useTranslations("pages.assets");
  const { data, isPending } = useFleetAssetAssignments();
  const { data: kpis = [] } = useFleetAssetKpis();
  const rows = data?.rows ?? [];
  const columns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "employee", label: t("colEmployee"), locked: true },
      { id: "empCompany", label: t("colEmpCompany") },
      { id: "plate", label: t("colPlate") },
      { id: "vehCompany", label: t("colVehicleCompany") },
      { id: "assetId", label: t("colAssetId"), locked: true },
      { id: "assetName", label: t("colAssetName") },
      { id: "project", label: t("colProject"), categorical: true },
      { id: "zone", label: t("colZone"), categorical: true },
    ],
    [t],
  );
  const prefs = useTablePrefs("asset-assignments", columns);
  const [projectKey, setProjectKey] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const needle = prefs.appliedQuery.trim().toLowerCase();
    return rows.filter((row) => {
      if (projectKey !== "all" && isDriverProjectKey(projectKey) && row.project_key !== projectKey) {
        return false;
      }
      if (!needle) return true;
      return [
        row.driver_name,
        row.employee_id,
        row.employee_company,
        row.vehicle_company,
        row.plate,
        row.asset_code,
        row.asset_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [prefs.appliedQuery, projectKey, rows]);
  const grouped = useMemo(
    () =>
      groupRows(
        visible,
        prefs.groupBy,
        {
          project: (row) => row.project_key,
          zone: (row) => row.zone,
        },
        {},
        "—",
      ),
    [prefs.groupBy, visible],
  );
  const listView = useGroupedListView(
    grouped,
    prefs.groupBy !== "none",
    `${prefs.groupBy}\u0001${prefs.appliedQuery}\u0001${projectKey}`,
  );
  const shownColumns = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));

  const selected = rows.find((row) => row.id === selectedId) ?? null;

  return (
    <>
      <AssetsFleetKpiStrip items={kpis} usedLabel={t("kpiUsed")} remainingLabel={t("kpiRemaining")} />
      <AppListCard
        toolbar={
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <p className="me-auto text-sm font-semibold">
              {t("assignmentsTitle")} ({rows.length})
            </p>
            <Select
              items={[
                { value: "all", label: t("projectAll") },
                { value: "keeta", label: t("projectKeeta") },
                { value: "americana", label: t("projectAmericana") },
              ]}
              value={projectKey}
              onValueChange={(value) => {
                if (value) setProjectKey(value);
              }}
            >
              <SelectTrigger className="h-9 w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" label={t("projectAll")}>
                  {t("projectAll")}
                </SelectItem>
                <SelectItem value="keeta" label={t("projectKeeta")}>
                  {t("projectKeeta")}
                </SelectItem>
                <SelectItem value="americana" label={t("projectAmericana")}>
                  {t("projectAmericana")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      >
        {isPending ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <AppEmptyState title={t("emptyAssignments")} description={t("emptyAssignmentsHint")} />
        ) : (
          <AppDataTable
            toolbar={
              <TableToolbar
                prefs={prefs}
                entity={t("assignmentsTitle")}
                columns={columns}
                rowKind="dynamic"
                filteredCount={visible.length}
                totalCount={rows.length}
              />
            }
            columns={shownColumns.map((column) => ({ id: column.id, label: column.label }))}
            empty={visible.length === 0 ? <AppDataTableEmpty>{t("emptySearchTitle")}</AppDataTableEmpty> : null}
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
                onClick={() => setSelectedId(row.id)}
              >
                {shownColumns.map((column) => {
                  switch (column.id) {
                    case "employee":
                      return (
                        <TableCell key={column.id} className="whitespace-nowrap">
                          <TableNameCell name={row.driver_name} />
                          {row.employee_id ? (
                            <p className="text-xs text-muted-foreground">{row.employee_id}</p>
                          ) : null}
                        </TableCell>
                      );
                    case "empCompany":
                      return (
                        <TableCell key={column.id} className="whitespace-nowrap">
                          {row.employee_company ? row.employee_company : <EmptyCell />}
                        </TableCell>
                      );
                    case "plate":
                      return (
                        <TableCell key={column.id} className="whitespace-nowrap font-medium">
                          {row.plate ? row.plate : <EmptyCell />}
                        </TableCell>
                      );
                    case "vehCompany":
                      return (
                        <TableCell key={column.id} className="whitespace-nowrap">
                          {row.vehicle_company ? row.vehicle_company : <EmptyCell />}
                        </TableCell>
                      );
                    case "assetId":
                      return (
                        <TableCell key={column.id} className="whitespace-nowrap font-medium">
                          {row.asset_code || <EmptyCell />}
                        </TableCell>
                      );
                    case "assetName":
                      return (
                        <TableCell key={column.id} className="whitespace-nowrap">
                          <TableNameCell name={row.asset_name} />
                        </TableCell>
                      );
                    case "project":
                      return (
                        <TableCell key={column.id}>
                          <ProjectBadge value={isDriverProjectKey(row.project_key) ? row.project_key : null} />
                        </TableCell>
                      );
                    case "zone":
                      return (
                        <TableCell key={column.id} className="whitespace-nowrap">
                          {row.zone ? row.zone : <EmptyCell />}
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
        )}
      </AppListCard>
      <AssetAssignmentDialog
        open={Boolean(selected)}
        row={selected}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      />
    </>
  );
}
