"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

export type SimpleConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  isPending?: boolean;
};

/** Single-step confirm for non–top-level actions (e.g. custom themes). */
export function SimpleConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  isPending: externalPending,
}: SimpleConfirmDialogProps) {
  const t = useTranslations("common");
  const [isPending, startTransition] = useTransition();
  const busy = isPending || externalPending;

  const handleConfirm = () => {
    startTransition(async () => {
      await onConfirm();
      onOpenChange(false);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="flex max-w-md flex-col gap-0 overflow-visible rounded-xl p-0"
        showCloseButton={!busy}
        closeOutside
      >
        <AppModalFooter title={title} subtitle={description}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 cursor-pointer rounded-md"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-9 cursor-pointer rounded-md px-4"
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              (confirmLabel ?? t("confirmDelete.confirmButton"))
            )}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
