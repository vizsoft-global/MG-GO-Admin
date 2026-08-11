"use client";

import {
  ClipboardList,
  FileWarning,
  Fuel,
  HandCoins,
  FileText,
  Package,
  CalendarOff,
  Settings2,
  ScrollText,
  BarChart3,
  PenLine,
  LayoutGrid,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { AppPage, AppPageHeader } from "@/components/app";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

type HubTile = {
  href: string;
  labelKey: string;
  hintKey: string;
  icon: typeof LayoutGrid;
  accent?: string;
};

const TILES: HubTile[] = [
  {
    href: "/requests/overview?type=leave",
    labelKey: "hub.leave",
    hintKey: "hub.leaveHint",
    icon: CalendarOff,
    accent: "bg-emerald-100 text-emerald-800",
  },
  {
    href: "/requests/overview?type=asset",
    labelKey: "hub.asset",
    hintKey: "hub.assetHint",
    icon: Package,
    accent: "bg-sky-100 text-sky-800",
  },
  {
    href: "/requests/overview?type=fuel",
    labelKey: "hub.fuel",
    hintKey: "hub.fuelHint",
    icon: Fuel,
    accent: "bg-amber-100 text-amber-900",
  },
  {
    href: "/requests/overview?type=loan",
    labelKey: "hub.loan",
    hintKey: "hub.loanHint",
    icon: HandCoins,
    accent: "bg-violet-100 text-violet-800",
  },
  {
    href: "/requests/overview?type=complaint",
    labelKey: "hub.complaint",
    hintKey: "hub.complaintHint",
    icon: FileWarning,
    accent: "bg-rose-100 text-rose-800",
  },
  {
    href: "/requests/overview?type=document",
    labelKey: "hub.document",
    hintKey: "hub.documentHint",
    icon: FileText,
    accent: "bg-teal-100 text-teal-800",
  },
  {
    href: "/requests/overview",
    labelKey: "hub.all",
    hintKey: "hub.allHint",
    icon: ClipboardList,
    accent: "bg-primary/15 text-primary",
  },
  {
    href: "/requests/reports",
    labelKey: "hub.reports",
    hintKey: "hub.reportsHint",
    icon: BarChart3,
    accent: "bg-muted text-foreground",
  },
  {
    href: "/requests/settings/audit",
    labelKey: "hub.audit",
    hintKey: "hub.auditHint",
    icon: ScrollText,
    accent: "bg-muted text-foreground",
  },
  {
    href: "/requests/settings",
    labelKey: "hub.settings",
    hintKey: "hub.settingsHint",
    icon: Settings2,
    accent: "bg-muted text-foreground",
  },
  {
    href: "/requests/esign",
    labelKey: "hub.esign",
    hintKey: "hub.esignHint",
    icon: PenLine,
    accent: "bg-indigo-100 text-indigo-800",
  },
];

export function RequestsHubShell() {
  const t = useTranslations("pages.requests");

  return (
    <AppPage>
      <AppPageHeader title={t("title")} description={t("hub.subtitle")} />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {TILES.map((tile) => {
          const Icon = tile.icon;
          return (
            <Link
              key={tile.href + tile.labelKey}
              href={tile.href}
              className={cn(
                "flex min-h-[88px] flex-col justify-between rounded-xl border border-border bg-card p-4 shadow-sm",
                "transition-colors hover:border-primary/40 hover:bg-primary/5",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {t(tile.labelKey)}
                </span>
                <span
                  className={cn(
                    "inline-flex h-8 w-8 items-center justify-center rounded-lg",
                    tile.accent,
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">
                {t(tile.hintKey)}
              </p>
            </Link>
          );
        })}
      </div>
    </AppPage>
  );
}
