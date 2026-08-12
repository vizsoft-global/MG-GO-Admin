"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { RequestRescheduleInput } from "./types";

/**
 * Reschedule is a proposal, not a decision, so it needs its own dates before it can be sent.
 * The rider answers it and the request goes back to the same approver.
 */
export function RequestRescheduleDialog({
  open,
  onOpenChange,
  requestCode,
  currentStartDate,
  currentEndDate,
  submitting,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestCode: string;
  currentStartDate: string | null;
  currentEndDate: string | null;
  submitting: boolean;
  onSubmit: (input: RequestRescheduleInput, note: string) => void;
}) {
  const t = useTranslations("pages.requests.detail.reschedule");
  const [startDate, setStartDate] = useState(currentStartDate ?? "");
  const [endDate, setEndDate] = useState(currentEndDate ?? "");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setStartDate(currentStartDate ?? "");
    setEndDate(currentEndDate ?? "");
    setNote("");
  }, [open, currentStartDate, currentEndDate]);

  const invalidRange =
    startDate !== "" && endDate !== "" && new Date(endDate) < new Date(startDate);
  const canSubmit = !submitting && !invalidRange && (startDate !== "" || endDate !== "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(560px,96vw)] overflow-visible pt-4"
        showCloseButton
        closeOutside
      >
        <div className="grid gap-3 px-5 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>{t("newStart")}</Label>
            <Input
              type="date"
              className="h-9"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("newEnd")}</Label>
            <Input
              type="date"
              className="h-9"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>{t("note")}</Label>
            <Textarea
              className="min-h-16 text-sm"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("notePlaceholder")}
            />
          </div>
          <p
            className={
              invalidRange
                ? "text-[10px] text-destructive sm:col-span-2"
                : "text-[10px] text-muted-foreground sm:col-span-2"
            }
          >
            {invalidRange ? t("invalidRange") : t("hint")}
          </p>
        </div>

        <div className="px-2 pb-2 pt-3">
          <AppModalFooter title={t("title")} subtitle={t("subtitle", { code: requestCode })}>
            <Button
              type="button"
              variant="outline"
              className="h-9"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              className="h-9"
              disabled={!canSubmit}
              onClick={() =>
                onSubmit(
                  {
                    new_start_date: startDate || null,
                    new_end_date: endDate || null,
                  },
                  note,
                )
              }
            >
              {t("submit")}
            </Button>
          </AppModalFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
