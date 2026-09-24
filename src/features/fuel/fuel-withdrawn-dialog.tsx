"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldBlock, FieldLabel } from "@/features/drivers/form/driver-form-primitives";
import { FleetRecordDialog } from "@/features/fleet/fleet-record-dialog";
import { queryKeys } from "@/lib/query/query-keys";
import { saveFuelWithdrawnOverride } from "./fuel-actions";
import { formatKwd } from "./fuel-week";
import type { FuelLogRow } from "./fuel-week";

export function FuelWithdrawnDialog({
  open,
  row,
  monthKey,
  onOpenChange,
}: {
  open: boolean;
  row: FuelLogRow | null;
  monthKey: string;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.fuel");
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !row) return;
    setDraft(formatKwd(row.withdrawn));
  }, [open, row]);

  if (!row) return null;

  const save = async () => {
    const amount = Number(draft.replace(/,/g, ""));
    if (!row.vehicleId || !Number.isFinite(amount) || amount < 0) {
      toast.error(t("withdrawnInvalid"));
      return;
    }
    setSaving(true);
    const result = await saveFuelWithdrawnOverride({
      driverId: row.driverId,
      vehicleId: row.vehicleId,
      monthKey,
      amountKwd: amount,
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(t("withdrawnInvalid"));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: queryKeys.fuel.withdrawn(monthKey) });
    toast.success(t("withdrawnSaved"));
    onOpenChange(false);
  };

  return (
    <FleetRecordDialog
      open={open}
      scroll={false}
      onOpenChange={onOpenChange}
      footer={
        <AppModalFooter
          title={t("editWithdrawn")}
          subtitle={`${row.driverName ?? "—"} · ${monthKey}`}
        >
          <Button type="button" variant="outline" className="h-9" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("cancel")}
          </Button>
          <Button type="button" className="h-9" onClick={() => void save()} disabled={saving || !row.vehicleId}>
            {t("save")}
          </Button>
        </AppModalFooter>
      }
    >
      <FieldBlock>
        <FieldLabel htmlFor="fuel-withdrawn-amount" required>
          {t("withdrawn")}
        </FieldLabel>
        <Input
          id="fuel-withdrawn-amount"
          inputMode="decimal"
          className="h-9"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <p className="text-[10px] text-muted-foreground">{t("editWithdrawnHint", { limit: formatKwd(row.monthlyLimit) })}</p>
      </FieldBlock>
    </FleetRecordDialog>
  );
}
