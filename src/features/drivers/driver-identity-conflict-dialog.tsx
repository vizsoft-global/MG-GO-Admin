"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { conflictStateKey, type IdentityConflict } from "./driver-delete";

/**
 * "Employee ID already assigned" used to be the whole answer, and the record
 * behind it can be an unfinished profile that never appears in the Employees
 * list. This names the holder and links straight to it.
 */
export function DriverIdentityConflictDialog({
  conflict,
  onClose,
}: {
  conflict: IdentityConflict | null;
  onClose: () => void;
}) {
  const t = useTranslations("pages.driverNew");
  if (!conflict) return null;

  const fieldLabel =
    conflict.field === "phone"
      ? t("conflictFieldPhone")
      : conflict.field === "civil_id"
        ? t("conflictFieldCivilId")
        : conflict.field === "passport"
          ? t("conflictFieldPassport")
          : t("conflictFieldEmployeeId");

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="flex max-w-md flex-col gap-0 overflow-visible rounded-xl p-0" closeOutside>
        <div className="space-y-3 px-5 pt-4 pb-2">
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <p className="font-semibold text-foreground">
              {t("conflictTitle", { field: fieldLabel })}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t(conflictStateKey(conflict) as "conflictNotApproved")}
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">{t("conflictName")}</dt>
              <dd className="font-medium text-foreground">{conflict.name ?? "—"}</dd>
              <dt className="text-muted-foreground">{t("conflictEmployeeId")}</dt>
              <dd className="font-mono font-medium text-foreground">{conflict.employeeId ?? "—"}</dd>
              <dt className="text-muted-foreground">{t("conflictPhone")}</dt>
              <dd className="font-mono font-medium text-foreground">{conflict.phone ?? "—"}</dd>
            </dl>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">{t("conflictHint")}</p>
        </div>
        <AppModalFooter title={t("conflictFooter")} subtitle={fieldLabel}>
          <Button type="button" variant="outline" size="sm" className="h-9" onClick={onClose}>
            {t("close")}
          </Button>
          <Button type="button" size="sm" className="h-9" nativeButton={false} render={<Link href={`/drivers/${conflict.id}`} />}>
            {t("conflictOpen")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
