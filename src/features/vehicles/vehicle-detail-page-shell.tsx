"use client";

import { useMemo, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Bike, Car, CircleDot, Pencil } from "lucide-react";
import { toast } from "sonner";
import { AppPage } from "@/components/app";
import { Button } from "@/components/ui/button";
import { SearchSelect } from "@/components/ui/search-select";
import { TabBar } from "@/components/dashboard/tab-bar";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import {
  CarTypeBadge,
  ConditionBadge,
  KindBadge,
  ProjectBadge,
  VehicleStatusBadge,
} from "@/features/fleet/fleet-badges";
import { isDriverProjectKey } from "@/features/fleet/fleet-labels";
import { VehicleFormDialog } from "./vehicle-form-dialog";
import { VehicleDetailTabs } from "./vehicle-tabs";
import { assignVehicleDriver } from "./vehicles-actions";
import { listVehicleTabDrivers } from "./vehicle-tabs-actions";
import { useVehiclesList } from "./use-vehicles";
import type { VehicleListRow, VehicleTypeRow } from "./types";

const TABS = ["handover", "accident", "documents", "service", "assets"] as const;
type DetailTab = (typeof TABS)[number];

function parseTab(value: string | null | undefined): DetailTab {
  return TABS.includes(value as DetailTab) ? (value as DetailTab) : "handover";
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

export function VehicleDetailPageShell({
  vehicle,
  types,
  editOpen,
}: {
  vehicle: VehicleListRow;
  types: VehicleTypeRow[];
  editOpen: boolean;
}) {
  const t = useTranslations("pages.vehicles");
  const tDetail = useTranslations("pages.vehicleDetail");
  const { can } = useAuth();
  const canManage = can("vehicles.manage");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: vehicles = [] } = useVehiclesList();
  const [tab, setTab] = useState<DetailTab>("handover");
  const [pending, startTransition] = useTransition();
  const plate = vehicle.reg_number || vehicle.bike_id;
  const KindIcon = vehicle.vehicle_type_key === "car" ? Car : Bike;
  const drivers = useQuery({
    queryKey: [...queryKeys.vehicles.all(), "tab-drivers"],
    queryFn: listVehicleTabDrivers,
  });
  const driverItems = useMemo(
    () =>
      (drivers.data ?? []).map((item) => ({
        value: item.id,
        label: item.label,
        keywords: item.keywords,
      })),
    [drivers.data],
  );

  const fuelLabel = vehicle.fuel_type ? t(`fuelType.${vehicle.fuel_type}` as "fuelType.chip") : "—";
  const metaFields = [
    { label: t("colChassis"), value: vehicle.chassis_no || "—" },
    { label: t("fieldModel"), value: [vehicle.make, vehicle.model].filter(Boolean).join(" ") || "—" },
    { label: t("colYear"), value: vehicle.model_year != null ? String(vehicle.model_year) : "—" },
    { label: t("colKind"), value: vehicle.vehicle_type_label || "—" },
    {
      label: t("colCarType"),
      value: vehicle.car_type ? t(`carType.${vehicle.car_type}` as "carType.company") : "—",
    },
    { label: t("colTypeOfUse"), value: vehicle.type_of_use_label || "—" },
    { label: t("colFuelType"), value: fuelLabel },
    { label: t("colChip"), value: vehicle.chip_no || "—" },
    {
      label: t("fieldFuelLimit"),
      value: vehicle.fuel_monthly_limit_kwd != null ? String(vehicle.fuel_monthly_limit_kwd) : "—",
    },
    { label: t("colLocation"), value: vehicle.location_text || "—" },
    { label: t("colCarsCompany"), value: vehicle.owner_partner_name || "—" },
    { label: t("colReplacement"), value: vehicle.replaces_plate || "—" },
    { label: t("colDriver"), value: vehicle.assigned_driver_name || "—" },
    { label: t("fieldEmployeeId"), value: vehicle.assigned_employee_id || "—" },
    { label: t("fieldContact"), value: vehicle.assigned_driver_phone || "—" },
    {
      label: t("fieldDriverProject"),
      value: isDriverProjectKey(vehicle.assigned_project_key)
        ? vehicle.assigned_project_key
        : "—",
    },
  ];

  const assign = (next: string | null) => {
    startTransition(async () => {
      const result = await assignVehicleDriver(vehicle.id, next);
      if (result.error) {
        toast.error(t(`errors.${result.error}` as "errors.save_failed"));
        return;
      }
      toast.success(t("assignSaved"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all() });
      router.refresh();
    });
  };

  return (
    <AppPage>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-4 border-b border-border p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
          <div className="flex min-w-0 gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <KindIcon className="size-5" aria-hidden />
            </div>
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold">{plate}</h1>
                <KindBadge value={vehicle.vehicle_type_key} />
                <ConditionBadge value={vehicle.condition} />
                <VehicleStatusBadge status={vehicle.status} />
                {vehicle.car_type ? <CarTypeBadge value={vehicle.car_type} /> : null}
                {vehicle.assigned_on_duty ? (
                  <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500 bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-900 ring-1 ring-emerald-400/50">
                    <CircleDot className="size-3" />
                    {t("tabOnDuty")}
                  </span>
                ) : null}
                {isDriverProjectKey(vehicle.assigned_project_key) ? (
                  <ProjectBadge value={vehicle.assigned_project_key} />
                ) : null}
              </div>
            </div>
          </div>
          {canManage ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="w-[min(280px,100%)]">
                <SearchSelect
                  items={driverItems}
                  value={vehicle.assigned_driver_id}
                  onChange={assign}
                  placeholder={t("assignDriverPlaceholder")}
                  searchPlaceholder={t("assignDriverPlaceholder")}
                  recentsKey="vehicle-assign-driver"
                  disabled={pending}
                  className="h-9"
                />
              </div>
              <Button
                className="h-9 cursor-pointer rounded-lg"
                onClick={() => router.push(`/vehicles/${vehicle.id}?edit=1`)}
              >
                <Pencil className="me-2 h-3.5 w-3.5" />
                {t("edit")}
              </Button>
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 lg:grid-cols-6 sm:p-5">
          {metaFields.map((field) => (
            <MetaCard key={field.label} label={field.label} value={field.value} />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <TabBar
          activeId={tab}
          onSelect={(id) => setTab(parseTab(id))}
          items={[
            { id: "handover", label: tDetail("tabHandover") },
            { id: "accident", label: tDetail("tabAccident") },
            { id: "documents", label: tDetail("tabDocuments") },
            { id: "service", label: tDetail("tabService") },
            { id: "assets", label: tDetail("tabAssets") },
          ]}
        />
        <VehicleDetailTabs tab={tab} vehicle={vehicle} canManage={canManage} />
      </div>

      <VehicleFormDialog
        open={editOpen && canManage}
        vehicle={vehicle}
        types={types}
        vehicles={vehicles}
        onOpenChange={(open) => {
          if (!open) router.replace(`/vehicles/${vehicle.id}`);
        }}
        onSaved={() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all() });
          router.replace(`/vehicles/${vehicle.id}`);
          router.refresh();
        }}
      />
    </AppPage>
  );
}
