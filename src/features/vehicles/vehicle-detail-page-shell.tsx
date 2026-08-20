"use client";

import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { AppPage, AppPageHeader } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { VehicleFormDialog } from "./vehicle-form-dialog";
import type { VehicleListRow, VehicleTypeRow } from "./types";

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
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
  const assigned = vehicle.assigned_driver_name
    ? `${vehicle.assigned_driver_name}${vehicle.assigned_driver_code ? ` · ${vehicle.assigned_driver_code}` : ""}`
    : "—";

  return (
    <AppPage>
      <AppPageHeader
        title={vehicle.bike_id}
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
          <DetailRow label={t("fieldReg")} value={vehicle.reg_number ?? "—"} />
          <DetailRow label={t("colType")} value={vehicle.vehicle_type_label} />
          <DetailRow label={t("colStatus")} value={vehicle.status} />
          <DetailRow label={t("fieldMake")} value={vehicle.make ?? "—"} />
          <DetailRow label={t("fieldModel")} value={vehicle.model ?? "—"} />
          <DetailRow label={t("fieldProject")} value={vehicle.project_type} />
          <DetailRow label={t("colDriver")} value={assigned} />
        </CardContent>
      </Card>
      <VehicleFormDialog
        open={editOpen && canManage}
        vehicle={vehicle}
        types={types}
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
