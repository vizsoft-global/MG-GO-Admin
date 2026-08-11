"use client";

import { useTranslations } from "next-intl";
import { ExternalLink, Eye, ShieldCheck } from "lucide-react";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

export function RolesSettingsPanel() {
  const t = useTranslations("pages.requests.settings.roles");

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: t("hub"), href: "/requests/settings" },
          { label: t("title") },
        ]}
      />

      <div className="grid gap-2 lg:grid-cols-2">
        <AppListCard className="space-y-2 p-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-muted/40">
              <Eye className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
            <h3 className="text-sm font-semibold">{t("viewOnlyTitle")}</h3>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{t("viewOnlyBody")}</p>
        </AppListCard>

        <AppListCard className="space-y-2 p-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" />
            </span>
            <h3 className="text-sm font-semibold">{t("approverTitle")}</h3>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{t("approverBody")}</p>
        </AppListCard>
      </div>

      <AppListCard className="mt-2 flex flex-wrap items-center justify-between gap-2 p-4">
        <p className="text-[11px] text-muted-foreground">{t("grantsHint")}</p>
        <Button variant="outline" size="sm" className="h-9" render={<Link href="/requests/settings/departments" />}>
          <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
          {t("manageGrants")}
        </Button>
      </AppListCard>
    </AppPage>
  );
}
