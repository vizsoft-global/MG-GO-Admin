"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { setMaintenanceMode } from "@/features/settings/access-requests-actions";
import { Button } from "@/components/ui/button";
import { AppFormSection } from "@/components/app";

export function MaintenancePanel({ maintenanceMode }: { maintenanceMode: boolean }) {
  const t = useTranslations("pages.settings.maintenance");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <AppFormSection title={t("title")} description={t("subtitle")}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {maintenanceMode ? t("enabled") : t("disabled")}
        </p>
        <Button
          variant={maintenanceMode ? "destructive" : "default"}
          className="cursor-pointer rounded-lg"
          disabled={isPending}
          onClick={() => {
            startTransition(async () => {
              const result = await setMaintenanceMode(!maintenanceMode);
              if (result.error) {
                toast.error(t("errors.saveFailed"));
                return;
              }
              toast.success(maintenanceMode ? t("turnedOff") : t("turnedOn"));
              router.refresh();
            });
          }}
        >
          {maintenanceMode ? t("disable") : t("enable")}
        </Button>
      </div>
    </AppFormSection>
  );
}
