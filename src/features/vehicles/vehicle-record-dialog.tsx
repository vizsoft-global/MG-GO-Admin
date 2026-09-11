"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Car, ExternalLink, Pencil, UserRound } from "lucide-react";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Link } from "@/i18n/navigation";
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
import { SectionHeading } from "@/features/drivers/form/driver-form-primitives";
import type { VehicleListRow } from "./types";

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-3 py-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="min-w-0 text-sm font-medium">{value}</div>
    </div>
  );
}

export function VehicleRecordDialog({
  open,
  vehicle,
  canManage,
  onOpenChange,
  onEdit,
}: {
  open: boolean;
  vehicle: VehicleListRow | null;
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
}) {
  const t = useTranslations("pages.vehicles");
  if (!vehicle) return null;

  const since = formatReplacementSince(vehicle.replacement_started_at);
  const subtitle = [vehicle.model, vehicle.model_year].filter(Boolean).join(" ");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        closeOutside
        className="w-[min(1200px,96vw)] overflow-visible px-5 py-4"
      >
        <div className="space-y-3 pt-4">
          {vehicle.replaces_vehicle_id ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning-bg px-3 py-2 text-xs text-warning">
              <p>
                <span className="font-semibold">{t("replacementBanner")}</span>
                {since ? ` — ${since}` : ""}
                {vehicle.replaces_plate ? ` · ${t("replacesPlate")} ${vehicle.replaces_plate}` : ""}
              </p>
              <VehicleStatusBadge status={vehicle.status} />
            </div>
          ) : null}

          <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
            <div className="flex h-full flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
              <SectionHeading icon={Car} accent="primary">
                {t("sectionVehicleDetails")}
              </SectionHeading>
              <div className="mt-2">
                <DetailRow label={t("colPlate")} value={vehicle.reg_number ?? "—"} />
                <DetailRow
                  label={t("colChassis")}
                  value={<span className="font-mono text-xs">{vehicle.chassis_no ?? "—"}</span>}
                />
                <DetailRow label={t("colKind")} value={<KindBadge value={vehicle.vehicle_type_key} />} />
                <DetailRow label={t("fieldModel")} value={vehicle.model ?? "—"} />
                <DetailRow label={t("colYear")} value={vehicle.model_year ?? "—"} />
                <DetailRow label={t("colCondition")} value={<ConditionBadge value={vehicle.condition} />} />
                <DetailRow label={t("colCarType")} value={<CarTypeBadge value={vehicle.car_type} />} />
                <DetailRow label={t("colStatus")} value={<VehicleStatusBadge status={vehicle.status} />} />
                <DetailRow label={t("colCarsCompany")} value={vehicle.owner_partner_name ?? "—"} />
                <DetailRow
                  label={t("colTypeOfUse")}
                  value={vehicle.type_of_use ? t(`typeOfUse.${vehicle.type_of_use}`) : "—"}
                />
                <DetailRow label={t("colLocation")} value={vehicle.location_text ?? "—"} />
                <DetailRow label={t("colFuelType")} value={<FuelTypeBadge value={vehicle.fuel_type} />} />
                <DetailRow label={t("colFuelCompany")} value={<FuelCompanyBadge value={vehicle.fuel_company} />} />
                <DetailRow
                  label={t("colChip")}
                  value={<span className="font-mono text-xs">{vehicle.chip_no ?? "—"}</span>}
                />
                <DetailRow
                  label={t("colReplacement")}
                  value={
                    vehicle.replaces_vehicle_id ? (
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <ReplacementBadge active />
                        {vehicle.replaces_plate ? <span>{vehicle.replaces_plate}</span> : null}
                        {since ? <span className="text-muted-foreground">{since}</span> : null}
                      </span>
                    ) : (
                      t("replacementNo")
                    )
                  }
                />
              </div>
            </div>

            <div className="flex h-full flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
              <SectionHeading icon={UserRound} accent="primary">
                {t("sectionDriver")}
              </SectionHeading>
              <div className="mt-2">
                <DetailRow label={t("fieldDriverName")} value={vehicle.assigned_driver_name ?? "—"} />
                <DetailRow label={t("fieldEmployeeId")} value={vehicle.assigned_employee_id ?? "—"} />
                <DetailRow label={t("colEmpCompany")} value={vehicle.assigned_partner_name ?? "—"} />
                <DetailRow label={t("fieldContact")} value={vehicle.assigned_driver_phone ?? "—"} />
                <DetailRow
                  label={t("fieldDriverProject")}
                  value={<ProjectBadge value={vehicle.assigned_project_key} />}
                />
                <DetailRow label={t("fieldZone")} value={vehicle.assigned_zone_name ?? "—"} />
                <DetailRow label={t("fieldAccommodation")} value={vehicle.assigned_accommodation ?? "—"} />
              </div>
              {vehicle.assigned_driver_id ? (
                <div className="mt-auto pt-3">
                  <Button
                    variant="ghost"
                    className="h-9 text-primary hover:bg-primary/10"
                    render={<Link href={`/drivers/${vehicle.assigned_driver_id}`} />}
                  >
                    <ExternalLink className="me-2 h-3.5 w-3.5" />
                    {t("viewProfile")}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>

          <AppModalFooter
            title={vehicle.reg_number || vehicle.bike_id}
            subtitle={subtitle || t("recordSubtitle")}
          >
            <Button type="button" variant="outline" className="h-9" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant="ghost"
              className="h-9 text-primary hover:bg-primary/10"
              render={<Link href={`/vehicles/${vehicle.id}`} />}
            >
              <ExternalLink className="me-2 h-3.5 w-3.5" />
              {t("viewDetails")}
            </Button>
            {canManage ? (
              <Button type="button" className="h-9" onClick={onEdit}>
                <Pencil className="me-2 h-3.5 w-3.5" />
                {t("edit")}
              </Button>
            ) : null}
          </AppModalFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
