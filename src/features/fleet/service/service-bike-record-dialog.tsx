"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { queryKeys } from "@/lib/query/query-keys";
import { createServiceRecord } from "./service-actions";
import { BIKE_PROGRAM_DEFAULTS } from "./service-bike-import";
import { programLabel } from "./service-programs";
import type { MaintenanceVehicle } from "./service-maintenance-model";
import { serviceErrorKey } from "./use-service";

/**
 * Manual bike service entry.
 *
 * The second of the two intake paths that do not wait for Bajaj Care. It writes
 * the same `vehicle_services` row the importer does — same fields, same Done
 * stage — so a record typed here and a record imported from a sheet are
 * indistinguishable to the calculation.
 */
export function ServiceBikeRecordDialog({
  open,
  onOpenChange,
  vehicles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicles: readonly MaintenanceVehicle[];
}) {
  const t = useTranslations("pages.fleetService");
  const queryClient = useQueryClient();
  const today = kuwaitTodayYmd();
  const [vehicleId, setVehicleId] = useState("");
  const [programKey, setProgramKey] = useState<string>("oil_change");
  const [serviceDay, setServiceDay] = useState(today);
  const [odometer, setOdometer] = useState("");
  const [cost, setCost] = useState("");
  const [vendor, setVendor] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!vehicleId) {
      toast.error(t("errors.missingVehicle"));
      return;
    }
    setSaving(true);
    const result = await createServiceRecord({
      vehicleId,
      servicedAt: serviceDay,
      description: "",
      serviceTypeKey: programKey,
      driverId: "",
      invoiceNo: "",
      invoiceDate: "",
      company: "",
      vendor,
      notes,
      odometerKm: odometer.trim() === "" ? null : Number(odometer),
      costKwd: cost.trim() === "" ? null : Number(cost),
      parts: [],
    });
    setSaving(false);
    if ("error" in result) {
      toast.error(t(serviceErrorKey(result.error)));
      return;
    }
    toast.success(t("created"));
    void queryClient.invalidateQueries({ queryKey: queryKeys.service.all() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all() });
    setOdometer("");
    setCost("");
    setVendor("");
    setNotes("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton closeOutside className="w-[min(520px,96vw)]">
        <div className="space-y-3 px-5 pt-4 pb-2">
          <label className="block space-y-1 text-xs">
            <span className="block font-medium">{t("form.vehicle")}</span>
            <Select
              items={vehicles.map((vehicle) => ({
                value: vehicle.id,
                label: `${vehicle.plate} · ${vehicle.model ?? "—"}`,
              }))}
              value={vehicleId || null}
              onValueChange={(next) => setVehicleId(next ?? "")}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder={t("form.selectVehicle")} />
              </SelectTrigger>
              <SelectContent>
                {vehicles.map((vehicle) => (
                  <SelectItem key={vehicle.id} value={vehicle.id}>
                    {vehicle.plate} · {vehicle.model ?? "—"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="block space-y-1 text-xs">
            <span className="block font-medium">{t("form.serviceType")}</span>
            <Select
              items={BIKE_PROGRAM_DEFAULTS.map((entry) => ({
                value: entry.key,
                label: programLabel(entry.key, "en"),
              }))}
              value={programKey}
              onValueChange={(next) => setProgramKey(next ?? "oil_change")}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BIKE_PROGRAM_DEFAULTS.map((entry) => (
                  <SelectItem key={entry.key} value={entry.key}>
                    {programLabel(entry.key, "en")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs">
              <span className="block font-medium">{t("cols.date")}</span>
              <Input
                type="date"
                max={today}
                className="h-9 tabular-nums"
                value={serviceDay}
                onChange={(event) => setServiceDay(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="block font-medium">{t("cols.odometer")}</span>
              <Input
                type="number"
                min={0}
                className="h-9 tabular-nums"
                value={odometer}
                onChange={(event) => setOdometer(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="block font-medium">{t("cols.cost")}</span>
              <Input
                type="number"
                min={0}
                step="0.1"
                className="h-9 tabular-nums"
                value={cost}
                onChange={(event) => setCost(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="block font-medium">{t("cols.vendor")}</span>
              <Input
                className="h-9"
                value={vendor}
                onChange={(event) => setVendor(event.target.value)}
              />
            </label>
          </div>
          <label className="block space-y-1 text-xs">
            <span className="block font-medium">{t("form.notes")}</span>
            <Input
              className="h-9"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </div>
        <AppModalFooter title={t("bikes.addRecord")}>
          <Button
            type="button"
            variant="outline"
            className="h-9"
            onClick={() => onOpenChange(false)}
          >
            {t("actions.cancel")}
          </Button>
          <Button type="button" className="h-9" disabled={saving} onClick={() => void save()}>
            {t("actions.save")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}

