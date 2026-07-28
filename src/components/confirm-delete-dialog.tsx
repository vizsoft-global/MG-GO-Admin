"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Two-step typed delete for top-level records only (e.g. partners, zones).
 * For files, uploads, or other sub-items, remove inline or use SimpleConfirmDialog.
 */
export type ConfirmDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dialog heading, e.g. "Delete partner" */
  itemTitle: string;
  /** Display name shown in step 1, e.g. partner name */
  itemName: string;
  /** Exact string the user must type to enable delete in step 2 */
  confirmText: string;
  /** Optional extra warning (e.g. drivers still assigned) */
  warning?: string;
  onConfirm: () => void | Promise<void>;
  isPending?: boolean;
};

function normalizeConfirmValue(value: string): string {
  return value.trim();
}

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  itemTitle,
  itemName,
  confirmText,
  warning,
  onConfirm,
  isPending: externalPending,
}: ConfirmDeleteDialogProps) {
  const t = useTranslations("common.confirmDelete");
  const [step, setStep] = useState<1 | 2>(1);
  const [typed, setTyped] = useState("");
  const [isPending, startTransition] = useTransition();

  const expected = normalizeConfirmValue(confirmText);
  const matches =
    expected.length > 0 &&
    normalizeConfirmValue(typed) === expected;
  const busy = isPending || externalPending;

  useEffect(() => {
    if (!open) {
      setStep(1);
      setTyped("");
    }
  }, [open]);

  const handleOpenChange = (next: boolean) => {
    if (busy) return;
    onOpenChange(next);
  };

  const handleConfirm = () => {
    if (!matches) return;
    startTransition(async () => {
      await onConfirm();
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md gap-0" showCloseButton={!busy}>
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>{itemTitle}</DialogTitle>
          {step === 1 ? (
            <DialogDescription className="pt-1 text-start">
              {t("step1Description", { name: itemName })}
            </DialogDescription>
          ) : (
            <DialogDescription className="pt-1 text-start">
              {t("step2Description", { text: confirmText })}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-4 px-6 py-4">
          {warning ? (
            <p
              className={cn(
                "rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive",
              )}
            >
              {warning}
            </p>
          ) : null}

          {step === 2 ? (
            <div className="space-y-2">
              <Label htmlFor="confirm-delete-input">{t("inputLabel")}</Label>
              <Input
                id="confirm-delete-input"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={t("inputPlaceholder", { text: confirmText })}
                className="rounded-lg font-mono"
                autoComplete="off"
                autoFocus
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && matches) handleConfirm();
                }}
              />
              {typed.length > 0 && !matches ? (
                <p className="text-xs text-destructive">{t("mismatch")}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex-row justify-end gap-2 border-t border-border px-6 py-4">
          {step === 1 ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="cursor-pointer rounded-lg"
                onClick={() => handleOpenChange(false)}
                disabled={busy}
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="cursor-pointer rounded-lg"
                onClick={() => setStep(2)}
                disabled={busy}
              >
                {t("continue")}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                className="cursor-pointer rounded-lg"
                onClick={() => setStep(1)}
                disabled={busy}
              >
                {t("back")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="cursor-pointer rounded-lg"
                onClick={handleConfirm}
                disabled={busy || !matches}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t("confirmButton")
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
