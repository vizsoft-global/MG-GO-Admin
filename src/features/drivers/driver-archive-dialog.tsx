"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function DriverArchiveDialog({
  open,
  onOpenChange,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onConfirm: (reason: string) => void | Promise<void>;
}) {
  const t = useTranslations("pages.driverDetail");
  const tCommon = useTranslations("common");
  const [reason, setReason] = useState("");
  const [submittedEmpty, setSubmittedEmpty] = useState(false);

  useEffect(() => {
    if (!open) {
      setReason("");
      setSubmittedEmpty(false);
    }
  }, [open]);

  const trimmed = reason.trim();
  const invalid = trimmed.length === 0;

  async function handleConfirm() {
    if (invalid) {
      setSubmittedEmpty(true);
      return;
    }
    await onConfirm(trimmed);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="flex max-w-md flex-col gap-0 overflow-visible rounded-xl p-0"
        showCloseButton={!pending}
        closeOutside
      >
        <div className="space-y-3 px-5 pt-4 pb-2">
          <div className="space-y-1">
            <Label htmlFor="driver-archive-reason">
              {t("archiveReasonLabel")}
              <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="driver-archive-reason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                if (submittedEmpty) setSubmittedEmpty(false);
              }}
              placeholder={t("archiveReasonPlaceholder")}
              className="min-h-20"
              disabled={pending}
              autoFocus
            />
            {submittedEmpty ? (
              <p className="text-xs text-destructive">{t("archiveReasonRequired")}</p>
            ) : null}
          </div>
        </div>
        <AppModalFooter title={t("archiveDriver")} subtitle={t("archiveConfirm")}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 cursor-pointer rounded-md"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-9 cursor-pointer rounded-md px-4"
            onClick={() => void handleConfirm()}
            disabled={pending || invalid}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("archiveDriver")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
