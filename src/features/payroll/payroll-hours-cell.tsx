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
import { savePayrollDayHours } from "./payroll-actions";
import { cn } from "@/lib/utils";
import { shownHours } from "./payroll-projects";

export type HoursEditTarget = {
  driverId: string;
  riderName: string;
  mgId: string;
  date: string;
  current: number | null;
};

function formatHours(value: number | null): string {
  if (value == null) return "–";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * One day's hours.
 *
 * **Keeta** prints them grey and read-only: they come from the daily upload and
 * correcting one means uploading a corrected file, exactly like Orders in
 * Americana. **Five Guys** lets the operator type a figure, but every change
 * needs a reason — an hours cell is a payable figure, and a silent edit is the
 * one thing this grid must not allow.
 */
export function PayrollHoursCell({
  info,
  editable,
  onEdit,
}: {
  info: { workingHours?: number | null } | null | undefined;
  editable: boolean;
  onEdit: () => void;
}) {
  const value = shownHours(info);
  if (!editable) {
    return (
      <span
        className="inline-flex min-w-8 justify-center rounded bg-muted/50 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground"
        title="Read-only · loaded by the daily upload"
      >
        {formatHours(value)}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onEdit}
      className={cn(
        "inline-flex min-w-8 justify-center rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums",
        value == null
          ? "text-muted-foreground hover:bg-muted/60"
          : "bg-white text-[#292A3F] ring-1 ring-inset ring-[#292A3F] hover:bg-muted/40",
      )}
    >
      {formatHours(value)}
    </button>
  );
}

export function PayrollHoursDialog({
  target,
  today,
  onClose,
}: {
  target: HoursEditTarget | null;
  today: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={target != null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent showCloseButton closeOutside className="w-[min(420px,96vw)]">
        {target ? (
          <HoursForm key={`${target.driverId}_${target.date}`} target={target} today={today} onClose={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function HoursForm({
  target,
  today,
  onClose,
}: {
  target: HoursEditTarget;
  today: string;
  onClose: () => void;
}) {
  const t = useTranslations("pages.payroll.hoursEdit");
  const queryClient = useQueryClient();
  const [value, setValue] = useState(target.current == null ? "" : String(target.current));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const parsed = value.trim() === "" ? null : Number(value);
  const invalid = parsed != null && (!Number.isFinite(parsed) || parsed < 0 || parsed > 24);

  async function save() {
    setSaving(true);
    try {
      await savePayrollDayHours(target.driverId, target.date, parsed, reason.trim());
      toast.success(t("saved", { day: target.date }));
      void queryClient.invalidateQueries({ queryKey: queryKeys.payroll.all() });
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="space-y-3 px-5 pt-4 pb-2">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold">{target.riderName}</p>
          <p className="text-xs text-muted-foreground">
            {target.mgId} · {target.date}
          </p>
        </div>
        <label className="block space-y-1 text-xs">
          <span className="block font-medium">{t("hours")}</span>
          <Input
            type="number"
            min={0}
            max={24}
            step="0.5"
            className="h-9 tabular-nums"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={t("placeholder")}
          />
          <span className="block text-muted-foreground">{t("hint", { today })}</span>
        </label>
        <label className="block space-y-1 text-xs">
          <span className="block font-medium">{t("reason")}</span>
          <Input
            className="h-9"
            value={reason}
            maxLength={200}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("reasonPlaceholder")}
          />
        </label>
      </div>
      <AppModalFooter title={t("title")}>
        <Button type="button" variant="outline" className="h-9" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button
          type="button"
          className="h-9"
          disabled={saving || invalid || reason.trim() === ""}
          onClick={() => void save()}
        >
          {t("save")}
        </Button>
      </AppModalFooter>
    </>
  );
}
