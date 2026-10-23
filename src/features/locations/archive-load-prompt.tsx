"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Archive, Loader2 } from "lucide-react";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

export function ArchiveLoadPrompt({
  day,
  loading,
  onConfirm,
}: {
  day: string;
  loading: boolean;
  onConfirm: () => void;
}) {
  const t = useTranslations("pages.locations.archive");
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Archive className="h-4 w-4 shrink-0" />
          <span>{t("banner", { day })}</span>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-9"
          disabled={loading}
          onClick={() => setOpen(true)}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
          {t("load")}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(560px,96vw)] overflow-visible pt-4" showCloseButton closeOutside>
          <div className="space-y-3 px-5 py-4 text-sm text-muted-foreground">
            <p>{t("body", { day })}</p>
            <p className="text-xs">{t("feeNote")}</p>
          </div>
          <AppModalFooter title={t("title")} subtitle={t("subtitle", { day })}>
            <Button type="button" variant="outline" className="h-9" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              className="h-9"
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              {t("confirm")}
            </Button>
          </AppModalFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
