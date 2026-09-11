"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { AppPage, AppPageHeader } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import {
  CarTypeBadge,
  ConditionBadge,
  FuelCompanyBadge,
  FuelTypeBadge,
  KindBadge,
  ProjectBadge,
  ReplacementBadge,
  VehicleStatusBadge,
} from "@/features/fleet/fleet-badges";
import { formatReplacementSince } from "@/features/fleet/fleet-labels";
import { VehicleFormDialog } from "./vehicle-form-dialog";
import { useVehiclesList } from "./use-vehicles";
import type { VehicleListRow, VehicleTypeRow } from "./types";

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm font-medium">{value}</div>
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
  const assigned = vehicle.assigned_driver_name
    ? `${vehicle.assigned_driver_name}${vehicle.assigned_employee_id ? ` · ${vehicle.assigned_employee_id}` : ""}`
    : "—";

  return (
    <AppPage>
      <AppPageHeader
        title={vehicle.reg_number || vehicle.bike_id}
        description={tDetail("subtitle")}
        actions={
          canManage ? (
            <Button
              className="h-9 cursor-pointer rounded-lg"
              onClick={() => router.push(`/vehicles/${vehicle.id}?edit=1`)}
            >
              <Pencil className="me-2 h-3.5 w-3.5" />
              {t("edit")}
            </Button>
          ) : null
        }
      />
      <Card className="rounded-xl border-border shadow-sm">
        <CardContent className="p-4">
          <DetailRow label={t("fieldVehicleId")} value={vehicle.bike_id} />
          <DetailRow label={t("colPlate")} value={vehicle.reg_number ?? "—"} />
          <DetailRow label={t("colChassis")} value={vehicle.chassis_no ?? "—"} />
          <DetailRow label={t("colKind")} value={<KindBadge value={vehicle.vehicle_type_key} />} />
          <DetailRow label={t("colStatus")} value={<VehicleStatusBadge status={vehicle.status} />} />
          <DetailRow label={t("colCarType")} value={<CarTypeBadge value={vehicle.car_type} />} />
          <DetailRow label={t("colCondition")} value={<ConditionBadge value={vehicle.condition} />} />
          <DetailRow
            label={t("colTypeOfUse")}
            value={vehicle.type_of_use ? t(`typeOfUse.${vehicle.type_of_use}`) : "—"}
          />
          <DetailRow label={t("fieldMake")} value={vehicle.make ?? "—"} />
          <DetailRow label={t("fieldModel")} value={vehicle.model ?? "—"} />
          <DetailRow label={t("colYear")} value={vehicle.model_year ?? "—"} />
          <DetailRow label={t("colLocation")} value={vehicle.location_text ?? "—"} />
          <DetailRow label={t("colCarsCompany")} value={vehicle.owner_partner_name ?? "—"} />
          <DetailRow label={t("colFuelType")} value={<FuelTypeBadge value={vehicle.fuel_type} />} />
          <DetailRow label={t("colFuelCompany")} value={<FuelCompanyBadge value={vehicle.fuel_company} />} />
          <DetailRow label={t("colChip")} value={vehicle.chip_no ?? "—"} />
          <DetailRow
            label={t("colReplacement")}
            value={
              vehicle.replaces_vehicle_id ? (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <ReplacementBadge active />
                  <span>{vehicle.replaces_plate ?? "—"}</span>
                  <span>{formatReplacementSince(vehicle.replacement_started_at) ?? ""}</span>
                </span>
              ) : (
                t("replacementNo")
              )
            }
          />
          <DetailRow label={t("colDriver")} value={assigned} />
          <DetailRow
            label={t("fieldDriverProject")}
            value={<ProjectBadge value={vehicle.assigned_project_key} />}
          />
        </CardContent>
      </Card>
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
