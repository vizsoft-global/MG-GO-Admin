"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Bike,
  CircleDot,
  Loader2,
  Plus,
  Search,
  Users,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { useRouter } from "@/i18n/navigation";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { TabBar } from "@/components/dashboard/tab-bar";
import { useAuth } from "@/contexts/auth-context";
import { queryKeys } from "@/lib/query/query-keys";
import { VehicleFormDialog } from "./vehicle-form-dialog";
import { useVehicleTypes, useVehiclesList } from "./use-vehicles";
import type { VehicleListRow, VehicleStatus } from "./types";
import {
  parseVehicleListTab,
  vehicleListKpis,
  vehicleMatchesSearch,
  vehicleMatchesTab,
  type VehicleListTab,
} from "./vehicles-list-utils";

function statusTone(status: VehicleStatus): "default" | "secondary" | "destructive" {
  if (status === "active") return "default";
  if (status === "maintenance") return "secondary";
  return "destructive";
}

export function VehiclesPageShell({
  addOpen,
  tab,
}: {
  addOpen: boolean;
  tab?: string;
}) {
  const t = useTranslations("pages.vehicles");
  const { can } = useAuth();
  const canManage = can("vehicles.manage");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: vehicles = [], isLoading } = useVehiclesList();
  const { data: types = [] } = useVehicleTypes();
  const [search, setSearch] = useState("");
  const activeTab = parseVehicleListTab(tab);

  const replaceQuery = (next: { add?: boolean; tab?: VehicleListTab }) => {
    const params = new URLSearchParams();
    const nextTab = next.tab ?? activeTab;
    const nextAdd = next.add ?? addOpen;
    if (nextTab !== "all") params.set("tab", nextTab);
    if (nextAdd) params.set("add", "1");
    const qs = params.toString();
    router.replace(qs ? `/vehicles?${qs}` : "/vehicles");
  };

  const visible = useMemo(
    () =>
      vehicles.filter(
        (row) => vehicleMatchesTab(row, activeTab) && vehicleMatchesSearch(row, search),
      ),
    [activeTab, search, vehicles],
  );

  const counts = useMemo(() => vehicleListKpis(vehicles), [vehicles]);
  const kpis = [
    { label: t("kpiTotal"), value: isLoading ? "—" : String(counts.total), icon: Bike, accent: "primary" as const },
    { label: t("kpiOnDuty"), value: isLoading ? "—" : String(counts.onDuty), icon: CircleDot, accent: "success" as const },
    { label: t("kpiSuspended"), value: isLoading ? "—" : String(counts.suspended), icon: Ban, accent: "danger" as const },
    { label: t("kpiGroup"), value: isLoading ? "—" : String(counts.group), icon: Users },
    { label: t("kpiRent"), value: isLoading ? "—" : String(counts.rent), icon: Wallet },
    { label: t("kpiMaintenance"), value: isLoading ? "—" : String(counts.maintenance), icon: Wrench, accent: "warning" as const },
  ];

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Button
            className="h-9 cursor-pointer rounded-lg"
            disabled={!canManage}
            onClick={() => {
              if (canManage) replaceQuery({ add: true });
            }}
          >
            <Plus className="me-2 h-3.5 w-3.5" />
            {t("addVehicle")}
          </Button>
        }
        tabs={
          <TabBar
            activeId={activeTab}
            onSelect={(id) => replaceQuery({ tab: parseVehicleListTab(id) })}
            items={[
              { id: "all", label: t("tabAll"), icon: Bike },
              { id: "suspended", label: t("tabSuspended"), icon: Ban },
              { id: "on-duty", label: t("tabOnDuty"), icon: CircleDot },
            ]}
          />
        }
      />
      <KpiGrid items={kpis} compact />
      <AppListCard
        toolbar={
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-9 rounded-lg bg-background ps-9 pe-9"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute end-2 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        }
      >
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : vehicles.length === 0 ? (
          <AppEmptyState title={t("emptyTitle")} description={t("emptyHint")} />
        ) : (
          <AppDataTable
            columns={[
              { id: "bike", label: t("colBikeId") },
              { id: "reg", label: t("colReg") },
              { id: "type", label: t("colType") },
              { id: "driver", label: t("colDriver") },
              { id: "status", label: t("colStatus") },
            ]}
            empty={visible.length === 0 ? <AppDataTableEmpty>{t("emptyFilters")}</AppDataTableEmpty> : null}
          >
            {visible.map((row) => (
              <VehicleRow
                key={row.id}
                row={row}
                onOpen={() => router.push(`/vehicles/${row.id}`)}
              />
            ))}
          </AppDataTable>
        )}
      </AppListCard>
      <VehicleFormDialog
        open={addOpen && canManage}
        vehicle={null}
        types={types}
        onOpenChange={(open) => {
          if (!open) replaceQuery({ add: false });
        }}
        onSaved={(id) => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all() });
          router.replace(`/vehicles/${id}`);
        }}
      />
    </AppPage>
  );
}

function VehicleRow({
  row,
  onOpen,
}: {
  row: VehicleListRow;
  onOpen: () => void;
}) {
  const t = useTranslations("pages.vehicles");
  const statusLabel =
    row.status === "active"
      ? t("statusActive")
      : row.status === "maintenance"
        ? t("statusMaintenance")
        : t("statusSuspended");
  return (
    <AppDataTableRow className="cursor-pointer" onClick={onOpen}>
      <TableCell>
        <p className="font-medium">{row.bike_id}</p>
        <p className="text-[11px] text-primary">{t("viewDetails")}</p>
      </TableCell>
      <TableCell>{row.reg_number ?? "—"}</TableCell>
      <TableCell>{row.vehicle_type_label}</TableCell>
      <TableCell>
        {row.assigned_driver_name
          ? `${row.assigned_driver_name}${row.assigned_driver_code ? ` · ${row.assigned_driver_code}` : ""}`
          : "—"}
      </TableCell>
      <TableCell>
        <Badge variant={statusTone(row.status)}>{statusLabel}</Badge>
      </TableCell>
    </AppDataTableRow>
  );
}
