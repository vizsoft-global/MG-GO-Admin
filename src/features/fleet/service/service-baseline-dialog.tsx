"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { saveMaintenanceBaseline } from "./service-actions";
import { serviceErrorKey } from "./use-service";

type BaselineTarget = {
  vehicleId: string;
  programKey: string;
  plate: string;
  programLabel: string;
  currentKm: number | null;
};

/**
 * **Enter last service** — the one form that turns a `needs_baseline` row into a
 * countable one.
 *
 * It writes a real Done `vehicle_services` row, so the record appears on the
 * Records tab and can carry a cost later; it is not a hidden offset. A kilometre
 * *or* a date is enough: whichever is left blank keeps that dimension at
 * `needs_baseline`, which is honest about what we know rather than defaulting to
 * today.
 */
export function ServiceBaselineDialog({
  target,
  today,
  onOpenChange,
  onSaved,
}: {
  target: BaselineTarget | null;
  today: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={target != null} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton closeOutside className="w-[min(440px,96vw)]">
        {/* Keyed on the target: a new vehicle mounts a fresh form, so a figure
            from the previous plate can never be carried over. */}
        {target ? (
          <BaselineForm
            key={`${target.vehicleId}_${target.programKey}`}
            target={target}
            today={today}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function BaselineForm({
  target,
  today,
  onClose,
  onSaved,
}: {
  target: BaselineTarget;
  today: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("pages.fleetService");
  const [day, setDay] = useState(today);
  const [km, setKm] = useState(target.currentKm == null ? "" : String(target.currentKm));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const result = await saveMaintenanceBaseline({
      vehicleId: target.vehicleId,
      programKey: target.programKey,
      serviceDay: day,
      odometerKm: km.trim() === "" ? null : Number(km),
    });
    setSaving(false);
    if ("error" in result) {
      toast.error(t(serviceErrorKey(result.error)));
      return;
    }
    toast.success(t("maintenance.baselineSaved", { program: target.programLabel }));
    onSaved();
    onClose();
  }

  return (
    <>
      <div className="space-y-3 px-5 pt-4 pb-2">
        <p className="text-sm text-muted-foreground">
          {t("maintenance.baselineHelp", {
            plate: target.plate,
            program: target.programLabel,
          })}
        </p>
        <label className="block space-y-1 text-xs">
          <span className="block font-medium">{t("maintenance.baselineDate")}</span>
          <Input
            type="date"
            max={today}
            className="h-9 tabular-nums"
            value={day}
            onChange={(event) => setDay(event.target.value)}
          />
        </label>
        <label className="block space-y-1 text-xs">
          <span className="block font-medium">{t("maintenance.baselineKm")}</span>
          <Input
            type="number"
            min={0}
            className="h-9 tabular-nums"
            value={km}
            onChange={(event) => setKm(event.target.value)}
            placeholder={t("form.odometerPlaceholder")}
          />
          <span className="block text-muted-foreground">{t("maintenance.baselineKmHint")}</span>
        </label>
      </div>
      <AppModalFooter title={t("maintenance.setupEnterLast")}>
        <Button type="button" variant="outline" className="h-9" onClick={onClose}>
          {t("actions.cancel")}
        </Button>
        <Button type="button" className="h-9" disabled={saving || !day} onClick={() => void save()}>
          {t("actions.save")}
        </Button>
      </AppModalFooter>
    </>
  );
}
