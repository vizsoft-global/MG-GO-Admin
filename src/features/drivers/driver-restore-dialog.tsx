"use client";

import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

export function DriverRestoreDialog({
  open,
  onOpenChange,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const t = useTranslations("pages.driverDetail");
  const tCommon = useTranslations("common");

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
        <div className="px-5 pt-4" />
        <AppModalFooter title={t("restoreDriver")} subtitle={t("restoreConfirm")}>
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
            size="sm"
            className="h-9 cursor-pointer rounded-md px-4"
            onClick={() => void onConfirm()}
            disabled={pending}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("restoreDriver")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
