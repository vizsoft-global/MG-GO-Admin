"use client";

import { useTranslations } from "next-intl";
import {
  CalendarDays,
  ChevronRight,
  FileSignature,
  ListChecks,
  Plus,
  ShieldCheck,
  Tags,
} from "lucide-react";
import { AppPage, AppPageHeader } from "@/components/app";
import { Link } from "@/i18n/navigation";
import { useEsignStatusCounts } from "./use-esign";

const TILES = [
  { href: "/requests/esign/sent", key: "sent", icon: FileSignature },
  { href: "/requests/esign/signatures", key: "signatures", icon: ListChecks },
  { href: "/requests/esign/categories", key: "categories", icon: Tags },
  { href: "/visit-bookings/calendar?from=requests-esign", key: "calendar", icon: CalendarDays },
  { href: "/requests/settings/screenshot", key: "screenshot", icon: ShieldCheck },
] as const;

export function EsignHubShell() {
  const t = useTranslations("pages.requests.esign.hub");
  const { data: counts } = useEsignStatusCounts();

  function tileMeta(key: (typeof TILES)[number]["key"]): string | null {
    if (key === "calendar") return t("tilesMeta.calendar");
    if (!counts) return null;
    switch (key) {
      case "sent":
        return t("tilesMeta.sent", { total: counts.all, pending: counts.pending });
      case "signatures":
        return t("tilesMeta.signatures", { pending: counts.pending });
      case "categories":
      case "screenshot":
        return t("tilesMeta.categories", { count: counts.categories });
      default:
        return null;
    }
  }

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
        className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 p-4 shadow-sm transition-colors hover:bg-primary/15"
      >
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Plus className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t("newRequest")}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{t("newRequestBody")}</p>
          <p className="mt-1 text-[10px] font-medium text-primary">{t("newRequestMeta")}</p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-primary" />
      </Link>

      <div className="grid gap-2 sm:grid-cols-2">
        {TILES.map((tile) => {
          const meta = tileMeta(tile.key);
          return (
            <Link
              key={tile.href}
              href={tile.href}
              className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40"
            >
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground">
                <tile.icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t(`tiles.${tile.key}`)}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {t(`tilesDesc.${tile.key}`)}
                </p>
                {meta ? (
                  <p className="mt-1 text-[10px] text-muted-foreground/80">{meta}</p>
                ) : null}
              </div>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          );
        })}
      </div>
    </AppPage>
  );
}
