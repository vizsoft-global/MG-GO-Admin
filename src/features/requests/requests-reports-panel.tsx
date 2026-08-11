"use client";

import { useTranslations } from "next-intl";
import { BarChart3 } from "lucide-react";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";

export function RequestsReportsPanel() {
  const t = useTranslations("pages.requests.settings.reports");

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

      <AppListCard className="flex flex-col items-center gap-2 p-8 text-center">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-muted/30">
          <BarChart3 className="h-5 w-5 text-muted-foreground" />
        </span>
        <p className="text-sm font-medium">{t("stubTitle")}</p>
        <p className="max-w-md text-[11px] text-muted-foreground">{t("stubBody")}</p>
      </AppListCard>
    </AppPage>
  );
}
