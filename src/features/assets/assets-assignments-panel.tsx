"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Search } from "lucide-react";
import { AppListCard } from "@/components/app";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  const [search, setSearch] = useState("");
  const [projectKey, setProjectKey] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
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
  }, [projectKey, rows, search]);

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
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("assignmentsSearch")}
                className="h-9 rounded-lg bg-background ps-9"
              />
            </div>
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
            columns={[
              { id: "employee", label: t("colEmployee") },
              { id: "empCompany", label: t("colEmpCompany") },
              { id: "plate", label: t("colPlate") },
              { id: "vehCompany", label: t("colVehicleCompany") },
              { id: "assetId", label: t("colAssetId") },
              { id: "assetName", label: t("colAssetName") },
              { id: "project", label: t("colProject") },
              { id: "zone", label: t("colZone") },
            ]}
            empty={visible.length === 0 ? <AppDataTableEmpty>{t("emptySearchTitle")}</AppDataTableEmpty> : null}
          >
            {visible.map((row) => (
              <AppDataTableRow
                key={row.id}
                className="cursor-pointer"
                onClick={() => setSelectedId(row.id)}
              >
                <TableCell className="whitespace-nowrap">
                  <p className="font-medium">{row.driver_name}</p>
                  {row.employee_id ? (
                    <p className="text-[11px] text-muted-foreground">{row.employee_id}</p>
                  ) : null}
                </TableCell>
                <TableCell className="whitespace-nowrap">{row.employee_company ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap font-medium">{row.plate ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap">{row.vehicle_company ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap font-medium">{row.asset_code}</TableCell>
                <TableCell className="whitespace-nowrap">{row.asset_name}</TableCell>
                <TableCell>
                  <ProjectBadge value={isDriverProjectKey(row.project_key) ? row.project_key : null} />
                </TableCell>
                <TableCell className="whitespace-nowrap">{row.zone ?? "—"}</TableCell>
              </AppDataTableRow>
            ))}
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
