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
import { clearMaintenanceOverride, saveMaintenanceOverride } from "./service-actions";
import { serviceErrorKey } from "./use-service";
import type { MaintenanceProgramRow } from "./types";

/**
 * **Next service** — a due point the fleet team sets by hand for one vehicle ×
 * program.
 *
 * The two dimensions are independent on purpose. A workshop told "next oil at
 * 92,000" may have no date for it, and an annual inspection may have no mileage
 * at all; leaving a field blank keeps that dimension on the interval rule rather
 * than inventing a figure. The derived values are shown beside the inputs so the
 * operator can see what they are overriding and what clearing restores.
 */
export function ServiceNextDueDialog({
  row,
  onOpenChange,
}: {
  row: MaintenanceProgramRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={row != null} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton closeOutside className="w-[min(460px,96vw)]">
        {/* Keyed on the row so a figure from the previous plate cannot be carried
            over when the dialog is used twice in a row. */}
        {row ? (
          <NextDueForm
            key={`${row.vehicleId}_${row.programKey}`}
            row={row}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function NextDueForm({
  row,
  onClose,
}: {
  row: MaintenanceProgramRow;
  onClose: () => void;
}) {
  const t = useTranslations("pages.fleetService");
  const queryClient = useQueryClient();
  const [km, setKm] = useState(row.nextKmOverridden ? String(row.nextDueKm ?? "") : "");
  const [date, setDate] = useState(row.nextDateOverridden ? row.nextDueDate ?? "" : "");
  const [saving, setSaving] = useState(false);

  const kmNumber = km.trim() === "" ? null : Number(km);
  const dateValue = date.trim() || null;
  const invalid =
    (kmNumber != null && (!Number.isFinite(kmNumber) || kmNumber < 0)) || (!kmNumber && !dateValue);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.service.all() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all() });
  }

  async function save() {
    setSaving(true);
    const result = await saveMaintenanceOverride({
      vehicleId: row.vehicleId,
      programKey: row.programKey,
      nextDueKm: kmNumber,
      nextDueDate: dateValue,
      previousKm: row.nextDueKm,
      previousDate: row.nextDueDate,
    });
    setSaving(false);
    if ("error" in result) {
      toast.error(t(serviceErrorKey(result.error)));
      return;
    }
    toast.success(t("maintenance.nextDueSaved", { program: row.programLabel }));
    refresh();
    onClose();
  }

  async function clear() {
    setSaving(true);
    const result = await clearMaintenanceOverride({
      vehicleId: row.vehicleId,
      programKey: row.programKey,
    });
    setSaving(false);
    if ("error" in result) {
      toast.error(t(serviceErrorKey(result.error)));
      return;
    }
    toast.success(t("maintenance.nextDueCleared", { program: row.programLabel }));
    refresh();
    onClose();
  }

  const overridden = row.nextKmOverridden || row.nextDateOverridden;

  return (
    <>
      <div className="space-y-3 px-5 pt-4 pb-2">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold">{row.plate}</p>
          <p className="text-xs text-muted-foreground">
            {row.programLabel}
            {row.lastServiceDate ? ` · ${t("maintenance.lastServiceOn", { day: row.lastServiceDate })}` : ""}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
          <div>
            <p className="text-muted-foreground">{t("maintenance.derivedKm")}</p>
            <p className="tabular-nums">
              {row.nextDueKm == null ? "—" : `${row.nextDueKm} km`}
              {row.nextKmOverridden ? ` · ${t("maintenance.overriddenTag")}` : ""}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("maintenance.derivedDate")}</p>
            <p className="tabular-nums">
              {row.nextDueDate ?? "—"}
              {row.nextDateOverridden ? ` · ${t("maintenance.overriddenTag")}` : ""}
            </p>
          </div>
        </div>

        <label className="block space-y-1 text-xs">
          <span className="block font-medium">{t("maintenance.nextDueKm")}</span>
          <Input
            type="number"
            min={0}
            className="h-9 tabular-nums"
            value={km}
            onChange={(event) => setKm(event.target.value)}
            placeholder={t("maintenance.nextDueKmPlaceholder")}
          />
        </label>
        <label className="block space-y-1 text-xs">
          <span className="block font-medium">{t("maintenance.nextDueDate")}</span>
          <Input
            type="date"
            className="h-9 tabular-nums"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <span className="block text-muted-foreground">{t("maintenance.nextDueHint")}</span>
        </label>
      </div>
      <AppModalFooter title={t("maintenance.setNextDue")}>
        {overridden ? (
          <Button
            type="button"
            variant="outline"
            className="h-9 text-destructive hover:bg-destructive/10"
            disabled={saving}
            onClick={() => void clear()}
          >
            {t("maintenance.clearOverride")}
          </Button>
        ) : null}
        <Button type="button" variant="outline" className="h-9" onClick={onClose}>
          {t("actions.cancel")}
        </Button>
        <Button type="button" className="h-9" disabled={saving || invalid} onClick={() => void save()}>
          {t("actions.save")}
        </Button>
      </AppModalFooter>
    </>
  );
}
