"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { invalidateDriverCaches } from "./invalidate-driver-caches";
import { setDriverScreenshotsAllowed } from "./drivers-actions";
import { isDriverErrorKey } from "./driver-errors";

export function DriverScreenshotsAllowedEditor({
  driverId,
  intakeId,
  allowed,
  canManage,
}: {
  driverId: string;
  intakeId?: string | null;
  allowed: boolean;
  canManage: boolean;
}) {
  const t = useTranslations("pages.driverDetail");
  const queryClient = useQueryClient();
  const [value, setValue] = useState(allowed);
  const [isPending, startTransition] = useTransition();

  const errorMessage = (error: string | undefined) => {
    const key = isDriverErrorKey(error) ? error : "save_failed";
    return t(`block.errors.${key}` as "block.errors.save_failed");
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t("screenshotsAllowedHint")}</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            {value ? t("screenshotsAllowedOn") : t("screenshotsAllowedOff")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="screenshotsAllowed" className="text-sm">
            {t("screenshotsAllowedToggle")}
          </Label>
          <Switch
            id="screenshotsAllowed"
            checked={value}
            disabled={!canManage || isPending}
            onCheckedChange={(checked) => {
              startTransition(async () => {
                const result = await setDriverScreenshotsAllowed(driverId, checked);
                if ("error" in result) {
                  toast.error(errorMessage(result.error));
                  return;
                }
                setValue(checked);
                toast.success(
                  checked
                    ? t("screenshotsAllowedSavedOn")
                    : t("screenshotsAllowedSavedOff"),
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
