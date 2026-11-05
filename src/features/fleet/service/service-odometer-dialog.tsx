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
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const reading = km.trim() === "" ? null : Number(km);
  // A reading below the stored figure is allowed for a person — a typo or a
  // replaced meter — but it must carry a written reason.
  const lowering = reading != null && currentKm != null && Number.isFinite(reading) && reading < currentKm;

  async function save() {
    if (reading == null || !Number.isFinite(reading)) {
      toast.error(t("errors.invalidOdometer"));
      return;
    }
    if (lowering && reason.trim().length < 3) {
      toast.error(t("errors.reasonRequired"));
      return;
    }
    setSaving(true);
    const result = await recordManualOdometer({
      vehicleId,
      km: reading,
      reason: lowering ? reason.trim() : null,
    });
    setSaving(false);
    if ("error" in result) {
      if (result.error === "odometer_below_current") {
        toast.error(t("errors.odometerBelowCurrent", { km: result.currentKm ?? 0 }));
        return;
      }
      toast.error(t(serviceErrorKey(result.error)));
      return;
    }
    toast.success(
      lowering ? t("odometerSavedLowered", { km: result.km ?? 0 }) : t("odometerSaved"),
    );
    setKm("");
    setReason("");
    onOpenChange(false);
    void queryClient.invalidateQueries({ queryKey: queryKeys.service.all() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all() });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton closeOutside className="w-[min(440px,96vw)]">
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
            {currentKm == null ? t("odometer.unknown") : t("odometer.current", { km: currentKm })}
          </p>
          {lowering ? (
            <>
              <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                {t("odometer.loweringWarning", { km: currentKm ?? 0, next: reading ?? 0 })}
              </p>
              <label className="space-y-1 text-xs">
                <span className="block font-medium">{t("odometer.reason")}</span>
                <Input
                  className="h-9"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={t("odometer.reasonPlaceholder")}
                />
                <span className="block text-muted-foreground">{t("odometer.reasonHint")}</span>
              </label>
            </>
          ) : null}
        </div>
        <AppModalFooter title={t("odometer.title")}>
          <Button type="button" variant="outline" className="h-9" onClick={() => onOpenChange(false)}>
            {t("actions.cancel")}
          </Button>
          <Button
            type="button"
            className="h-9"
            disabled={saving || (lowering && reason.trim().length < 3)}
            onClick={() => void save()}
          >
            {t("actions.save")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
