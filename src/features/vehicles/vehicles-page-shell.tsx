"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@/i18n/navigation";
import { Loader2, Plus, Search, X } from "lucide-react";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
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
import { useAuth } from "@/contexts/auth-context";
import { queryKeys } from "@/lib/query/query-keys";
import { VehicleFormDialog } from "./vehicle-form-dialog";
import { useVehicleTypes, useVehiclesList } from "./use-vehicles";
import type { VehicleListRow, VehicleStatus } from "./types";

function statusTone(status: VehicleStatus): "default" | "secondary" | "destructive" {
  if (status === "active") return "default";
  if (status === "maintenance") return "secondary";
  return "destructive";
}

export function VehiclesPageShell({ addOpen }: { addOpen: boolean }) {
  const locale = useLocale();
  const t = useTranslations("pages.vehicles");
  const { can } = useAuth();
  const canManage = can("vehicles.manage");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: vehicles = [], isLoading } = useVehiclesList();
  const { data: types = [] } = useVehicleTypes();
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vehicles;
    return vehicles.filter((row) =>
      [row.bike_id, row.reg_number, row.assigned_driver_name, row.assigned_driver_code, row.vehicle_type_label]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [search, vehicles]);

  const kpis = useMemo(() => {
    const assigned = vehicles.filter((row) => row.assigned_driver_id).length;
    return [
      { label: t("kpiTotal"), value: String(vehicles.length) },
      { label: t("kpiActive"), value: String(vehicles.filter((row) => row.status === "active").length) },
      { label: t("kpiMaintenance"), value: String(vehicles.filter((row) => row.status === "maintenance").length) },
      { label: t("kpiAssigned"), value: String(assigned) },
    ];
  }, [t, vehicles]);

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          canManage ? (
            <Button
              className="h-9 cursor-pointer rounded-lg"
              onClick={() => router.push("/vehicles?add=1")}
            >
              <Plus className="me-2 h-3.5 w-3.5" />
              {t("addVehicle")}
            </Button>
          ) : null
        }
      />
      <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className="text-[11px] text-muted-foreground">{kpi.label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{kpi.value}</p>
          </div>
        ))}
      </div>
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
          <AppEmptyState title={t("emptyTitle")} />
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
                locale={locale}
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
          if (!open) router.replace("/vehicles");
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
  locale,
  onOpen,
}: {
  row: VehicleListRow;
  locale: string;
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
      <TableCell>{locale === "ar" ? row.vehicle_type_label : row.vehicle_type_label}</TableCell>
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
