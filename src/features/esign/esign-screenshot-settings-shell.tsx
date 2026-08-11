"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import {
  useEsignScreenshotDefault,
  useUpdateEsignScreenshotDefault,
} from "./use-esign";

export function EsignScreenshotSettingsShell() {
  const t = useTranslations("pages.requests.esign.screenshot");
  const tSettings = useTranslations("pages.requests.settings");
  const { data, isLoading } = useEsignScreenshotDefault();
  const update = useUpdateEsignScreenshotDefault();
  const [restricted, setRestricted] = useState(true);

  useEffect(() => {
    if (data?.value != null) setRestricted(data.value);
  }, [data?.value]);

  const save = async () => {
    const result = await update.mutateAsync(restricted);
    if (!result.ok) {
      toast.error(result.error ?? t("errors.saveFailed"));
      return;
    }
    toast.success(t("saved"));
  };

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: tSettings("title"), href: "/requests/settings" },
          { label: t("title") },
        ]}
      />

      <AppListCard className="space-y-3 p-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (
          <>
            <p className="text-sm font-medium">{t("defaultLabel")}</p>
            <p className="text-[11px] text-muted-foreground">{t("overrideNote")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <ToggleChip selected={restricted} onClick={() => setRestricted(true)}>
                {t("blocked")}
              </ToggleChip>
              <ToggleChip selected={!restricted} onClick={() => setRestricted(false)}>
                {t("allowed")}
              </ToggleChip>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="button"
                className="h-9"
                disabled={update.isPending || data?.value === restricted}
                onClick={() => void save()}
              >
                {update.isPending ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                {t("save")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9"
                render={<Link href="/requests/esign/categories" />}
              >
                {t("manageCategories")}
              </Button>
            </div>
          </>
        )}
      </AppListCard>
    </AppPage>
  );
}
