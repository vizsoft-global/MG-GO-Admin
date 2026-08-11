"use client";

import { useTranslations } from "next-intl";
import { ExternalLink, Package } from "lucide-react";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

export function EsignAssetsLinkShell() {
  const t = useTranslations("pages.requests.esign.assets");
  const tSettings = useTranslations("pages.requests.settings");

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

      <AppListCard className="flex flex-col items-start gap-3 p-4">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-muted/30">
          <Package className="h-5 w-5 text-muted-foreground" />
        </span>
        <p className="text-sm">{t("body")}</p>
        <Button
          type="button"
          className="h-9"
          render={<Link href="/assets" />}
        >
          <ExternalLink className="me-1.5 h-3.5 w-3.5" />
          {t("openAssets")}
        </Button>
      </AppListCard>
    </AppPage>
  );
}
