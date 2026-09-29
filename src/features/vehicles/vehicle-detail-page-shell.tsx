"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Bike, CircleDot, Pencil } from "lucide-react";
import { AppPage } from "@/components/app";
import { Button } from "@/components/ui/button";
import { TabBar } from "@/components/dashboard/tab-bar";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { ConditionBadge, KindBadge, VehicleStatusBadge } from "@/features/fleet/fleet-badges";
import { VehicleFormDialog } from "./vehicle-form-dialog";
import { VehicleDetailTabs } from "./vehicle-tabs";
import { useVehiclesList } from "./use-vehicles";
import type { VehicleListRow, VehicleTypeRow } from "./types";

const TABS = ["handover", "accident", "documents", "service", "assets"] as const;
type DetailTab = (typeof TABS)[number];

function parseTab(value: string | null | undefined): DetailTab {
  return TABS.includes(value as DetailTab) ? (value as DetailTab) : "handover";
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
  const plate = vehicle.reg_number || vehicle.bike_id;
  const assigned = vehicle.assigned_driver_name
    ? `${vehicle.assigned_driver_name}${vehicle.assigned_employee_id ? ` · ${vehicle.assigned_employee_id}` : ""}`
    : "—";

  return (
    <AppPage>
      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Bike className="size-4 text-primary" aria-hidden />
              <h1 className="text-lg font-semibold">{plate}</h1>
              <KindBadge value={vehicle.vehicle_type_key} />
              <ConditionBadge value={vehicle.condition} />
              <VehicleStatusBadge status={vehicle.status} />
              {vehicle.assigned_on_duty ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500 bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-900 ring-1 ring-emerald-400/50">
                  <CircleDot className="size-3" />
                  {t("tabOnDuty")}
                </span>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {t("colDriver")}: {assigned}
              {vehicle.type_of_use_label ? ` · ${vehicle.type_of_use_label}` : ""}
            </p>
          </div>
          {canManage ? (
            <Button
              className="h-9 cursor-pointer rounded-lg"
              onClick={() => router.push(`/vehicles/${vehicle.id}?edit=1`)}
            >
              <Pencil className="me-2 h-3.5 w-3.5" />
              {t("edit")}
            </Button>
          ) : null}
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
