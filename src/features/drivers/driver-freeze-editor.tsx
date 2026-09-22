"use client";

import { useMemo, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Ban, Loader2, Snowflake } from "lucide-react";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { StatusPill } from "@/components/dashboard/status-pill";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { formatKuwaitDateLabel } from "@/lib/date/kuwait-dates";
import { queryKeys } from "@/lib/query/query-keys";
import { invalidateDriverCaches } from "./invalidate-driver-caches";
import { listRestrictionReasons, setDriverFrozen, setDriverUnfrozen } from "./drivers-actions";
import { isDriverErrorKey } from "./driver-errors";
import { freezeUiState } from "./driver-freeze";
import {
  OTHER_REASON_VALUE,
  RestrictionReasonSelect,
  resolveRestrictionReason,
} from "./restriction-reason-select";

function matchReasonValue(
  stored: string | null,
  reasons: { id: string; label_en: string }[],
): { selected: string; other: string } {
  const text = stored?.trim() ?? "";
  if (!text) return { selected: "", other: "" };
  const hit = reasons.find((row) => row.label_en === text);
  if (hit) return { selected: hit.id, other: "" };
  return { selected: OTHER_REASON_VALUE, other: text };
}

export function DriverFreezeEditor({
  driverId,
  intakeId,
  frozenFrom,
  frozenUntil,
  freezeReason,
  frozenAt,
  canManage,
}: {
  driverId: string;
  intakeId?: string | null;
  frozenFrom: string | null;
  frozenUntil: string | null;
  freezeReason: string | null;
  frozenAt: string | null;
  canManage: boolean;
}) {
  const t = useTranslations("pages.driverDetail.freeze");
  const queryClient = useQueryClient();
  const today = kuwaitTodayYmd();
  const ui = freezeUiState(frozenFrom, frozenUntil, today);
  const live = ui === "active" || ui === "scheduled";

  const { data: reasons = [] } = useQuery({
    queryKey: queryKeys.drivers.restrictionReasons("freeze"),
    queryFn: () => listRestrictionReasons("freeze"),
  });

  const seeded = useMemo(
    () => matchReasonValue(freezeReason, reasons),
    [freezeReason, reasons],
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [unfreezeOpen, setUnfreezeOpen] = useState(false);
  const [from, setFrom] = useState(frozenFrom ?? today);
  const [until, setUntil] = useState(frozenUntil ?? today);
  const [selectedValue, setSelectedValue] = useState(seeded.selected);
  const [otherText, setOtherText] = useState(seeded.other);
  const [isPending, startTransition] = useTransition();

  const errorMessage = (error: string | undefined) => {
    const key = isDriverErrorKey(error) ? error : "save_failed";
    return t(`errors.${key}` as "errors.save_failed");
  };

  const openSet = () => {
    const next = matchReasonValue(freezeReason, reasons);
    setFrom(frozenFrom && ui !== "expired" ? frozenFrom : today);
    setUntil(frozenUntil && ui !== "expired" ? frozenUntil : today);
    setSelectedValue(next.selected);
    setOtherText(next.other);
    setDialogOpen(true);
  };

  const submitFreeze = () => {
    const reason = resolveRestrictionReason(selectedValue, otherText, reasons);
    if (reason.length < 3) {
      toast.error(t("reasonRequired"));
      return;
    }
    if (!from || !until) {
      toast.error(t("errors.missing_freeze_window"));
      return;
    }
    startTransition(async () => {
      const result = await setDriverFrozen(driverId, from, until, reason);
      if ("error" in result) {
        toast.error(errorMessage(result.error));
        return;
      }
      toast.warning(t("frozen"), { icon: <Ban className="size-4" /> });
      setDialogOpen(false);
      await invalidateDriverCaches(queryClient, { intakeId, profileId: driverId });
    });
  };

  const submitUnfreeze = () => {
    startTransition(async () => {
      const result = await setDriverUnfrozen(driverId);
      if ("error" in result) {
        toast.error(errorMessage(result.error));
        return;
      }
      toast.success(t("unfrozen"));
      setUnfreezeOpen(false);
      await invalidateDriverCaches(queryClient, { intakeId, profileId: driverId });
    });
  };

  const untilMin = from && from > today ? from : today;

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Label>{t("label")}</Label>
          <StatusPill
            variant={ui === "active" ? "danger" : ui === "scheduled" ? "warning" : "success"}
            dot={false}
          >
            {ui === "active"
              ? t("statusActive")
              : ui === "scheduled"
                ? t("statusScheduled")
                : t("statusInactive")}
          </StatusPill>
        </div>

        <p className="text-xs text-muted-foreground">{t("hint")}</p>

        {ui === "active" && freezeReason ? (
          <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-destructive">
              {t("reasonLabel")}
            </p>
            <p className="mt-1 text-sm text-foreground">{freezeReason}</p>
            <p className="mt-2 text-[10px] text-muted-foreground">
              {t("untilDate", { date: formatKuwaitDateLabel(frozenUntil ?? today) })}
            </p>
            {frozenAt ? (
              <p className="text-[10px] text-muted-foreground">
                {t("frozenAt", { date: new Date(frozenAt).toLocaleString() })}
              </p>
            ) : null}
          </div>
        ) : null}

        {ui === "scheduled" && freezeReason ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-900">
            <p className="text-[10px] font-medium uppercase tracking-wide">{t("scheduledLabel")}</p>
            <p className="mt-1 text-sm">{freezeReason}</p>
            <p className="mt-2 text-[10px]">
              {t("windowRange", {
                from: formatKuwaitDateLabel(frozenFrom ?? today),
                until: formatKuwaitDateLabel(frozenUntil ?? today),
              })}
            </p>
          </div>
        ) : null}

        {canManage ? (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-9 cursor-pointer"
              disabled={isPending}
              onClick={openSet}
            >
              <Snowflake className="size-4" />
              {live ? t("editFreeze") : t("setFreeze")}
            </Button>
            {live ? (
              <Button
                type="button"
                className="h-9 cursor-pointer"
                disabled={isPending}
                onClick={() => setUnfreezeOpen(true)}
              >
                {t("unfreeze")}
              </Button>
            ) : null}
          </div>
        ) : null}

        {isPending ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          showCloseButton
          closeOutside
          className="w-[min(480px,96vw)] overflow-visible p-0 pt-4"
        >
          <div className="space-y-3 px-5 py-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="freeze-from">{t("from")}</Label>
                <Input
                  id="freeze-from"
                  type="date"
                  className="h-9"
                  value={from}
                  min={today}
                  disabled={isPending}
                  onChange={(e) => {
                    const next = e.target.value;
                    setFrom(next);
                    if (until && next && until < next) setUntil(next);
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="freeze-until">{t("until")}</Label>
                <Input
                  id="freeze-until"
                  type="date"
                  className="h-9"
                  value={until}
                  min={untilMin}
                  disabled={isPending}
                  onChange={(e) => setUntil(e.target.value)}
                />
              </div>
            </div>
            <RestrictionReasonSelect
              fieldId="freeze-reason"
              reasons={reasons}
              selectedValue={selectedValue}
              otherText={otherText}
              onSelectedValueChange={setSelectedValue}
              onOtherTextChange={setOtherText}
              disabled={isPending}
            />
          </div>
          <AppModalFooter title={t("dialogTitle")} subtitle={t("dialogDescription")}>
            <Button
              type="button"
              variant="outline"
              className="h-9 cursor-pointer"
              disabled={isPending}
              onClick={() => setDialogOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-9 cursor-pointer"
              disabled={isPending}
              onClick={submitFreeze}
            >
              {isPending ? t("freezing") : t("confirmFreeze")}
            </Button>
          </AppModalFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={unfreezeOpen} onOpenChange={setUnfreezeOpen}>
        <DialogContent
          showCloseButton
          closeOutside
          className="w-[min(480px,96vw)] overflow-visible p-0 pt-4"
        >
          <div className="px-2 pb-2">
            <AppModalFooter title={t("unfreezeTitle")} subtitle={t("unfreezeDescription")}>
              <Button
                type="button"
                variant="outline"
                className="h-9 cursor-pointer"
                disabled={isPending}
                onClick={() => setUnfreezeOpen(false)}
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                className="h-9 cursor-pointer"
                disabled={isPending}
                onClick={submitUnfreeze}
              >
                {isPending ? t("unfreezing") : t("confirmUnfreeze")}
              </Button>
            </AppModalFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
