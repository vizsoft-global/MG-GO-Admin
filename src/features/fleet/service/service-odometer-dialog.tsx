"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { queryKeys } from "@/lib/query/query-keys";
import { recordManualOdometer } from "./service-actions";
import { serviceErrorKey } from "./use-service";

/**
 * The manual door onto `vehicles.current_odometer_km`. The same monotonic guard
 * as the Done stage: a reading below the stored figure is refused, because a
 * typo must not rewind preventive maintenance.
 */
export function ServiceOdometerDialog({
  vehicleId,
  currentKm,
  open,
  onOpenChange,
}: {
  vehicleId: string;
  currentKm: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.fleetService");
  const queryClient = useQueryClient();
  const [km, setKm] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const reading = Number(km);
    if (!Number.isFinite(reading) || km.trim() === "") {
      toast.error(t("errors.invalidOdometer"));
      return;
    }
    setSaving(true);
    const result = await recordManualOdometer({ vehicleId, km: reading });
    setSaving(false);
    if ("error" in result) {
      if (result.error === "odometer_below_current") {
        toast.error(t("errors.odometerBelowCurrent", { km: result.currentKm ?? 0 }));
        return;
      }
      toast.error(t(serviceErrorKey(result.error)));
      return;
    }
    toast.success(t("odometerSaved"));
    setKm("");
    onOpenChange(false);
    void queryClient.invalidateQueries({ queryKey: queryKeys.service.all() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all() });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton closeOutside className="w-[min(420px,96vw)]">
        <div className="space-y-2 px-5 pt-4 pb-2">
          <label className="space-y-1 text-xs">
            <span className="block font-medium">{t("odometer.title")}</span>
            <Input
              type="number"
              min={0}
              className="h-9 tabular-nums"
              value={km}
              onChange={(event) => setKm(event.target.value)}
              placeholder={currentKm == null ? t("odometer.placeholder") : String(currentKm)}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            {currentKm == null
              ? t("odometer.unknown")
              : t("odometer.current", { km: currentKm })}
          </p>
        </div>
        <AppModalFooter title={t("odometer.title")}>
          <Button type="button" variant="outline" className="h-9" onClick={() => onOpenChange(false)}>
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
