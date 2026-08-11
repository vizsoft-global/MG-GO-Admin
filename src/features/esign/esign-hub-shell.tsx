"use client";

import { useTranslations } from "next-intl";
import { FileSignature } from "lucide-react";
import { AppPage, AppPageHeader } from "@/components/app";
import { Link } from "@/i18n/navigation";

const TILES = [
  { href: "/requests/esign/sent", key: "sent" },
  { href: "/requests/esign/signatures", key: "signatures" },
  { href: "/requests/esign/categories", key: "categories" },
  { href: "/requests/settings/screenshot", key: "screenshot" },
] as const;

export function EsignHubShell() {
  const t = useTranslations("pages.requests.esign.hub");

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: t("requests"), href: "/requests" },
          { label: t("title") },
        ]}
      />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {TILES.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className="rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40"
          >
            <span className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
              <FileSignature className="h-4 w-4" />
            </span>
            <p className="text-sm font-medium">{t(`tiles.${tile.key}`)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t(`tilesDesc.${tile.key}`)}
            </p>
          </Link>
        ))}
      </div>
    </AppPage>
  );
}
