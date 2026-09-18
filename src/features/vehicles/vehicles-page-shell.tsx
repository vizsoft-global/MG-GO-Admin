"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Bike,
  CircleDot,
  ExternalLink,
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
import { Link } from "@/i18n/navigation";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { TabBar } from "@/components/dashboard/tab-bar";
import { useAuth } from "@/contexts/auth-context";
import { queryKeys } from "@/lib/query/query-keys";
import {
  CarTypeBadge,
  ConditionBadge,
  FuelCompanyBadge,
  FuelTypeBadge,
  KindBadge,
  ReplacementBadge,
  VehicleStatusBadge,
} from "@/features/fleet/fleet-badges";
import { formatReplacementSince } from "@/features/fleet/fleet-labels";
import { VehicleFormDialog } from "./vehicle-form-dialog";
import { VehicleRecordDialog } from "./vehicle-record-dialog";
import { useVehicleTypes, useVehiclesList } from "./use-vehicles";
import type { VehicleListRow } from "./types";
import {
  applyVehicleKpi,
  parseVehicleCarTypeFilter,
  parseVehicleKindFilter,
  parseVehicleListTab,
  parseVehicleProjectFilter,
  parseVehicleStatusFilter,
  parseVehicleTypeOfUseFilter,
  vehicleKpiSelected,
  vehicleListKpis,
  vehicleMatchesCarType,
  vehicleMatchesKind,
  vehicleMatchesProject,
  vehicleMatchesSearch,
  vehicleMatchesStatus,
  vehicleMatchesTab,
  vehicleMatchesTypeOfUse,
  type VehicleCarTypeFilter,
  type VehicleKindFilter,
  type VehicleKpiKey,
  type VehicleListTab,
  type VehicleProjectFilter,
  type VehicleStatusFilter,
  type VehicleTypeOfUseFilter,
} from "./vehicles-list-utils";

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
  const [projectFilter, setProjectFilter] = useState<VehicleProjectFilter>("all");
  const [statusFilter, setStatusFilter] = useState<VehicleStatusFilter>("all");
  const [carTypeFilter, setCarTypeFilter] = useState<VehicleCarTypeFilter>("all");
  const [typeOfUseFilter, setTypeOfUseFilter] = useState<VehicleTypeOfUseFilter>("all");
  const [kindFilter, setKindFilter] = useState<VehicleKindFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const activeTab = parseVehicleListTab(tab);
  const filterState = {
    tab: activeTab,
    status: statusFilter,
    carType: carTypeFilter,
    typeOfUse: typeOfUseFilter,
    kind: kindFilter,
    search,
    project: projectFilter,
  };

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
        (row) =>
          vehicleMatchesTab(row, activeTab) &&
          vehicleMatchesStatus(row, statusFilter) &&
          vehicleMatchesCarType(row, carTypeFilter) &&
          vehicleMatchesTypeOfUse(row, typeOfUseFilter) &&
          vehicleMatchesKind(row, kindFilter) &&
          vehicleMatchesProject(row, projectFilter) &&
          vehicleMatchesSearch(row, search),
      ),
    [activeTab, carTypeFilter, kindFilter, projectFilter, search, statusFilter, typeOfUseFilter, vehicles],
  );

  const applyKpi = (key: VehicleKpiKey) => {
    const next = applyVehicleKpi(key, filterState);
    setStatusFilter(next.status);
    setCarTypeFilter(next.carType);
    setTypeOfUseFilter(next.typeOfUse);
    setKindFilter(next.kind);
    setSearch(next.search);
    setProjectFilter(next.project);
    if (next.tab !== activeTab) replaceQuery({ tab: next.tab });
  };

  const counts = useMemo(() => vehicleListKpis(vehicles), [vehicles]);
  const selected = vehicles.find((row) => row.id === selectedId) ?? null;
  const editing = vehicles.find((row) => row.id === editId) ?? null;
  const kpis = [
    {
      key: "total" as const,
      label: t("kpiTotal"),
      value: isLoading ? "—" : String(counts.total),
      icon: Bike,
      accent: "primary" as const,
    },
    {
      key: "onDuty" as const,
      label: t("kpiOnDuty"),
      value: isLoading ? "—" : String(counts.onDuty),
      icon: CircleDot,
      accent: "success" as const,
    },
    {
      key: "suspended" as const,
      label: t("kpiSuspended"),
      value: isLoading ? "—" : String(counts.suspended),
      icon: Ban,
      accent: "danger" as const,
    },
    {
      key: "company" as const,
      label: t("kpiCompany"),
      value: isLoading ? "—" : String(counts.company),
      icon: Users,
    },
    {
      key: "rent" as const,
      label: t("kpiRent"),
      value: isLoading ? "—" : String(counts.rent),
      icon: Wallet,
    },
    {
      key: "underRepair" as const,
      label: t("kpiUnderRepair"),
      value: isLoading ? "—" : String(counts.underRepair),
      icon: Wrench,
      accent: "warning" as const,
    },
  ].map((kpi) => ({
    ...kpi,
    selected: vehicleKpiSelected(kpi.key, filterState),
    onClick: () => applyKpi(kpi.key),
  }));

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
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
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
            <Select
              items={[
                { value: "all", label: t("projectAll") },
                { value: "keeta", label: t("projectKeeta") },
                { value: "americana", label: t("projectAmericana") },
              ]}
              value={projectFilter}
              onValueChange={(value) => setProjectFilter(parseVehicleProjectFilter(value))}
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
            <Select
              items={[
                { value: "all", label: t("filterStatusAll") },
                { value: "active", label: t("statusActive") },
                { value: "suspended", label: t("statusSuspended") },
                { value: "maintenance", label: t("statusMaintenance") },
              ]}
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(parseVehicleStatusFilter(value))}
            >
              <SelectTrigger className="h-9 w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" label={t("filterStatusAll")}>
                  {t("filterStatusAll")}
                </SelectItem>
                <SelectItem value="active" label={t("statusActive")}>
                  {t("statusActive")}
                </SelectItem>
                <SelectItem value="suspended" label={t("statusSuspended")}>
                  {t("statusSuspended")}
                </SelectItem>
                <SelectItem value="maintenance" label={t("statusMaintenance")}>
                  {t("statusMaintenance")}
                </SelectItem>
              </SelectContent>
            </Select>
            <Select
              items={[
                { value: "all", label: t("filterCarTypeAll") },
                { value: "company", label: t("carType.company") },
                { value: "rent", label: t("carType.rent") },
                { value: "maintenance", label: t("carType.maintenance") },
              ]}
              value={carTypeFilter}
              onValueChange={(value) => setCarTypeFilter(parseVehicleCarTypeFilter(value))}
            >
              <SelectTrigger className="h-9 w-[168px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" label={t("filterCarTypeAll")}>
                  {t("filterCarTypeAll")}
                </SelectItem>
                <SelectItem value="company" label={t("carType.company")}>
                  {t("carType.company")}
                </SelectItem>
                <SelectItem value="rent" label={t("carType.rent")}>
                  {t("carType.rent")}
                </SelectItem>
                <SelectItem value="maintenance" label={t("carType.maintenance")}>
                  {t("carType.maintenance")}
                </SelectItem>
              </SelectContent>
            </Select>
            <Select
              items={[
                { value: "all", label: t("filterTypeOfUseAll") },
                { value: "operational", label: t("typeOfUse.operational") },
                { value: "trainer", label: t("typeOfUse.trainer") },
                { value: "standby", label: t("typeOfUse.standby") },
              ]}
              value={typeOfUseFilter}
              onValueChange={(value) => setTypeOfUseFilter(parseVehicleTypeOfUseFilter(value))}
            >
              <SelectTrigger className="h-9 w-[168px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" label={t("filterTypeOfUseAll")}>
                  {t("filterTypeOfUseAll")}
                </SelectItem>
                <SelectItem value="operational" label={t("typeOfUse.operational")}>
                  {t("typeOfUse.operational")}
                </SelectItem>
                <SelectItem value="trainer" label={t("typeOfUse.trainer")}>
                  {t("typeOfUse.trainer")}
                </SelectItem>
                <SelectItem value="standby" label={t("typeOfUse.standby")}>
                  {t("typeOfUse.standby")}
                </SelectItem>
              </SelectContent>
            </Select>
            <Select
              items={[
                { value: "all", label: t("filterKindAll") },
                { value: "bike", label: t("kindBike") },
                { value: "car", label: t("kindCar") },
              ]}
              value={kindFilter}
              onValueChange={(value) => setKindFilter(parseVehicleKindFilter(value))}
            >
              <SelectTrigger className="h-9 w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" label={t("filterKindAll")}>
                  {t("filterKindAll")}
                </SelectItem>
                <SelectItem value="bike" label={t("kindBike")}>
                  {t("kindBike")}
                </SelectItem>
                <SelectItem value="car" label={t("kindCar")}>
                  {t("kindCar")}
                </SelectItem>
              </SelectContent>
            </Select>
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
              { id: "plate", label: t("colPlate") },
              { id: "chassis", label: t("colChassis") },
              { id: "kind", label: t("colKind") },
              { id: "model", label: t("colModel") },
              { id: "year", label: t("colYear") },
              { id: "condition", label: t("colCondition") },
              { id: "chip", label: t("colChip") },
              { id: "fuelType", label: t("colFuelType") },
              { id: "fuelCompany", label: t("colFuelCompany") },
              { id: "carsCompany", label: t("colCarsCompany") },
              { id: "typeOfUse", label: t("colTypeOfUse") },
              { id: "location", label: t("colLocation") },
              { id: "driver", label: t("colDriver") },
              { id: "empCompany", label: t("colEmpCompany") },
              { id: "carType", label: t("colCarType") },
              { id: "replacement", label: t("colReplacement") },
              { id: "repPlate", label: t("colRepPlate") },
              { id: "since", label: t("colSince") },
            ]}
            empty={visible.length === 0 ? <AppDataTableEmpty>{t("emptyFilters")}</AppDataTableEmpty> : null}
          >
            {visible.map((row) => (
              <VehicleRow key={row.id} row={row} onOpen={() => setSelectedId(row.id)} />
            ))}
          </AppDataTable>
        )}
      </AppListCard>
      <VehicleRecordDialog
        open={Boolean(selected)}
        vehicle={selected}
        canManage={canManage}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        onEdit={() => {
          if (!selected) return;
          setEditId(selected.id);
          setSelectedId(null);
        }}
      />
      <VehicleFormDialog
        open={(addOpen || Boolean(editing)) && canManage}
        vehicle={editing}
        types={types}
        vehicles={vehicles}
        onOpenChange={(open) => {
          if (open) return;
          setEditId(null);
          if (addOpen) replaceQuery({ add: false });
        }}
        onSaved={(id) => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all() });
          setEditId(null);
          if (addOpen) replaceQuery({ add: false });
          setSelectedId(id);
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
  return (
    <AppDataTableRow className="cursor-pointer" onClick={onOpen}>
      <TableCell className="whitespace-nowrap">
        <p className="font-medium">{row.reg_number || row.bike_id}</p>
        {row.status !== "active" ? (
          <div className="mt-0.5">
            <VehicleStatusBadge status={row.status} />
          </div>
        ) : null}
        <Link
          href={`/vehicles/${row.id}`}
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:bg-primary/10"
          onClick={(event) => event.stopPropagation()}
        >
          <ExternalLink className="h-3 w-3" />
          {t("viewDetails")}
        </Link>
      </TableCell>
      <TableCell className="font-mono text-[11px] text-muted-foreground whitespace-nowrap">
        {row.chassis_no ?? "—"}
      </TableCell>
      <TableCell>
        <KindBadge value={row.vehicle_type_key} />
      </TableCell>
      <TableCell className="whitespace-nowrap">{row.model ?? "—"}</TableCell>
      <TableCell>{row.model_year ?? "—"}</TableCell>
      <TableCell>
        <ConditionBadge value={row.condition} />
      </TableCell>
      <TableCell className="font-mono text-[11px]">{row.chip_no ?? "—"}</TableCell>
      <TableCell>
        <FuelTypeBadge value={row.fuel_type} />
      </TableCell>
      <TableCell>
        <FuelCompanyBadge value={row.fuel_company} />
      </TableCell>
      <TableCell className="whitespace-nowrap">{row.owner_partner_name ?? "—"}</TableCell>
      <TableCell className="whitespace-nowrap">
        {row.type_of_use ? t(`typeOfUse.${row.type_of_use}`) : "—"}
      </TableCell>
      <TableCell className="whitespace-nowrap">{row.location_text ?? "—"}</TableCell>
      <TableCell className="whitespace-nowrap">
        {row.assigned_driver_name
          ? `${row.assigned_driver_name}${row.assigned_employee_id ? ` · ${row.assigned_employee_id}` : ""}`
          : "—"}
      </TableCell>
      <TableCell className="whitespace-nowrap">{row.assigned_partner_name ?? "—"}</TableCell>
      <TableCell>
        <CarTypeBadge value={row.car_type} />
      </TableCell>
      <TableCell>
        <ReplacementBadge active={Boolean(row.replaces_vehicle_id)} />
      </TableCell>
      <TableCell className="whitespace-nowrap">{row.replaces_plate ?? "—"}</TableCell>
      <TableCell className="whitespace-nowrap">
        {formatReplacementSince(row.replacement_started_at) ?? "—"}
      </TableCell>
    </AppDataTableRow>
  );
}
