"use client";

import { useTranslations } from "next-intl";
import {
  ChevronRight,
  FileSignature,
  ListChecks,
  Plus,
  ShieldCheck,
  Tags,
} from "lucide-react";
import { AppPage, AppPageHeader } from "@/components/app";
import { Link } from "@/i18n/navigation";

const TILES = [
  { href: "/requests/esign/sent", key: "sent", icon: FileSignature },
  { href: "/requests/esign/signatures", key: "signatures", icon: ListChecks },
  { href: "/requests/esign/categories", key: "categories", icon: Tags },
  { href: "/requests/settings/screenshot", key: "screenshot", icon: ShieldCheck },
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

      <Link
        href="/requests/esign/sent?add=1"
        className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary p-4 text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
      >
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/15">
          <Plus className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t("newRequest")}</p>
          <p className="mt-0.5 text-[11px] text-primary-foreground/80">{t("newRequestBody")}</p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0" />
      </Link>

      <div className="grid gap-2 sm:grid-cols-2">
        {TILES.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40"
          >
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
              <tile.icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t(`tiles.${tile.key}`)}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {t(`tilesDesc.${tile.key}`)}
              </p>
            </div>
            <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </AppPage>
  );
}
