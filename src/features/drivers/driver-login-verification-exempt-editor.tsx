"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { invalidateDriverCaches } from "./invalidate-driver-caches";
import { setDriverLoginVerificationExempt } from "./drivers-actions";
import { isDriverErrorKey } from "./driver-errors";

export function DriverLoginVerificationExemptEditor({
  driverId,
  intakeId,
  exempt,
  canManage,
}: {
  driverId: string;
  intakeId?: string | null;
  exempt: boolean;
  canManage: boolean;
}) {
  const t = useTranslations("pages.driverDetail");
  const queryClient = useQueryClient();
  const [value, setValue] = useState(exempt);
  const [isPending, startTransition] = useTransition();

  const errorMessage = (error: string | undefined) => {
    const key = isDriverErrorKey(error) ? error : "save_failed";
    return t(`block.errors.${key}` as "block.errors.save_failed");
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {t("loginVerificationExemptHint")}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            {value
              ? t("loginVerificationExemptOn")
              : t("loginVerificationExemptOff")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="loginVerificationExempt" className="text-sm">
            {t("loginVerificationExemptToggle")}
          </Label>
          <Switch
            id="loginVerificationExempt"
            checked={value}
            disabled={!canManage || isPending}
            onCheckedChange={(checked) => {
              startTransition(async () => {
                const result = await setDriverLoginVerificationExempt(
                  driverId,
                  checked,
                );
                if ("error" in result) {
                  toast.error(errorMessage(result.error));
                  return;
                }
                setValue(checked);
                toast.success(
                  checked
                    ? t("loginVerificationExemptSavedOn")
                    : t("loginVerificationExemptSavedOff"),
                );
                await invalidateDriverCaches(queryClient, {
                  intakeId,
                  profileId: driverId,
                });
              });
            }}
          />
        </div>
      </div>
    </div>
  );
}
