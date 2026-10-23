"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useDriverLevelOverride } from "./use-driver-levels";

export function DriverLevelOverrideDialog({
  driverId,
  open,
  onOpenChange,
}: {
  driverId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.drivers");
  const { save, pending } = useDriverLevelOverride();
  const [reason, setReason] = useState("");

  async function apply(level: "D" | "standard" | "clear") {
    const result = await save({ driverId, level, reason });
    if (!result.ok) {
      toast.error(t("levelOverrideFailed"));
      return;
    }
    toast.success(t("levelOverrideSaved"));
    setReason("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton closeOutside className="w-[min(480px,96vw)] overflow-visible p-0">
        <DialogTitle className="sr-only">{t("levelOverrideTitle")}</DialogTitle>
        <DialogDescription className="sr-only">{t("levelOverrideSubtitle")}</DialogDescription>
        <div className="space-y-3 px-5 py-4">
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("levelOverrideReason")}
            className="min-h-20 text-sm"
            maxLength={300}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="h-9" disabled={pending} onClick={() => void apply("D")}>
              {t("levelSetD")}
            </Button>
            <Button type="button" variant="outline" className="h-9" disabled={pending} onClick={() => void apply("standard")}>
              {t("levelSetStandard")}
            </Button>
          </div>
        </div>
        <AppModalFooter title={t("levelOverrideTitle")} subtitle={t("levelOverrideSubtitle")}>
          <Button type="button" variant="outline" className="h-9" disabled={pending} onClick={() => onOpenChange(false)}>
            {t("levelOverrideCancel")}
          </Button>
          <Button type="button" variant="outline" className="h-9" disabled={pending} onClick={() => void apply("clear")}>
            {t("levelOverrideClear")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DriverLevelBadge({ level }: { level: "D" | "standard" | null | undefined }) {
  const t = useTranslations("pages.drivers");
  if (level !== "D") return null;
  return (
    <span className="inline-flex h-5 items-center rounded-md border border-rose-300 bg-rose-50 px-1.5 text-xs font-bold text-rose-800">
      {t("levelBadgeD")}
    </span>
  );
}
