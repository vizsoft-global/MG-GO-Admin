"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteConfirmationMatches } from "./driver-delete";

/**
 * Permanent delete, so it asks for the MG ID typed back rather than a single
 * click — archive is the reversible door next to it.
 */
export function DriverDeleteDialog({
  open,
  onOpenChange,
  pending,
  employeeId,
  employeeName,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  /** The value the operator has to type back. */
  employeeId: string | null;
  employeeName: string | null;
  onConfirm: (typed: string) => void | Promise<void>;
}) {
  const t = useTranslations("pages.driverDetail");
  const tCommon = useTranslations("common");
  const [typed, setTyped] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) {
      setTyped("");
      setSubmitted(false);
    }
  }, [open]);

  const matches = deleteConfirmationMatches(typed, employeeId);

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
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-sm font-semibold text-destructive">{t("deleteWarning")}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("deleteBody")}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="driver-delete-confirm">
              {t("deleteConfirmLabel", { value: employeeId ?? t("deleteNoEmployeeId") })}
              <span className="text-destructive">*</span>
            </Label>
            <Input
              id="driver-delete-confirm"
              className="h-9 font-mono"
              value={typed}
              disabled={pending || !employeeId}
              autoFocus
              autoComplete="off"
              onChange={(event) => {
                setTyped(event.target.value);
                if (submitted) setSubmitted(false);
              }}
            />
            {!employeeId ? (
              <p className="text-xs text-destructive">{t("deleteNoEmployeeId")}</p>
            ) : submitted && !matches ? (
              <p className="text-xs text-destructive">{t("deleteMismatch")}</p>
            ) : null}
          </div>
        </div>
        <AppModalFooter
          title={t("deleteTitle")}
          subtitle={employeeName ?? employeeId ?? undefined}
        >
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
            disabled={pending || !matches}
            onClick={() => {
              setSubmitted(true);
              if (!matches) return;
              void onConfirm(typed.trim());
            }}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("deleteConfirmCta")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
