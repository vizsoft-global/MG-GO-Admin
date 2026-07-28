"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { AppPage } from "@/components/app/app-page";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query/query-keys";
import { isZoneErrorKey } from "./zone-errors";
import { ZoneFormBody } from "./zone-form-sheet";
import { deleteZone } from "./zones-actions";
import { useZonesList } from "./use-zones";

const ZONE_FORM_HEIGHT = "h-[calc(100dvh-1.5rem)] min-h-[640px]";

function zoneErrorToast(
  t: ReturnType<typeof useTranslations<"pages.zones">>,
  error?: string,
) {
  if (error && isZoneErrorKey(error)) {
    return t(`errors.${error}`);
  }
  return t("errors.save_failed");
}

export function ZoneFormPage({ zoneId }: { zoneId?: string }) {
  const t = useTranslations("pages.zones");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: zones = [], isLoading } = useZonesList();
  const zone = useMemo(
    () => (zoneId ? zones.find((item) => item.id === zoneId) ?? null : null),
    [zoneId, zones],
  );

  const invalidateZones = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.zones.all() });
  };

  const runDelete = async () => {
    if (!zone) return;
    const force = zone.driver_count > 0;
    const result = await deleteZone(zone.id, force);
    if (result.error) {
      toast.error(zoneErrorToast(t, result.error));
      throw new Error(result.error);
    }
    toast.success(t("deleted"));
    invalidateZones();
    router.push("/zones");
  };

  if (zoneId && isLoading) {
    return (
      <AppPage className="!space-y-0">
        <div
          className={cn(
            "flex items-center justify-center rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900",
            ZONE_FORM_HEIGHT,
          )}
        >
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppPage>
    );
  }

  if (zoneId && !zone) {
    return (
      <AppPage className="!space-y-0">
        <div
          className={cn(
            "flex items-center justify-center rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
            ZONE_FORM_HEIGHT,
          )}
        >
          {t("emptyTitle")}
        </div>
      </AppPage>
    );
  }

  return (
    <AppPage className="!space-y-0">
      <div className={cn("flex flex-col", ZONE_FORM_HEIGHT)}>
        <ZoneFormBody
          zone={zone}
          existingZones={zones}
          onClose={() => router.push("/zones")}
          onSaved={() => {
            invalidateZones();
            router.push("/zones");
          }}
          onRequestDelete={() => setDeleteOpen(true)}
        />
      </div>
      {zone ? (
        <ConfirmDeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          itemTitle={t("deleteZone")}
          itemName={zone.name}
          confirmText={zone.code}
          warning={
            zone.driver_count > 0
              ? t("deleteConfirmWithDrivers", { count: zone.driver_count })
              : undefined
          }
          onConfirm={runDelete}
        />
      ) : null}
    </AppPage>
  );
}
