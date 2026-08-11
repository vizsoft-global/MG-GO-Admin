"use client";

import {
  BarChart3,
  CalendarDays,
  LayoutGrid,
  Layers,
  List,
  ShieldCheck,
  Share2,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { AppPage, AppPageHeader } from "@/components/app";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query/query-keys";
import { fetchAdminVisitsList } from "./visits-actions";

type HubTile = {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  tint: string;
  perm?: "visits.operate" | "visits.manage_catalog";
  countKey?: "upcoming" | "today" | "awaiting_checkin";
};

const MANAGE_TILES: HubTile[] = [
  {
    href: "/visit-bookings/all",
    labelKey: "hub.allVisits",
    icon: List,
    tint: "bg-gradient-to-br from-teal-400 to-emerald-600",
    countKey: "upcoming",
  },
  {
    href: "/visit-bookings/calendar",
    labelKey: "hub.calendar",
    icon: CalendarDays,
    tint: "bg-gradient-to-br from-violet-400 to-purple-600",
    countKey: "today",
  },
  {
    href: "/visit-bookings/reception",
    labelKey: "hub.reception",
    icon: ShieldCheck,
    tint: "bg-gradient-to-br from-orange-400 to-orange-600",
    perm: "visits.operate",
    countKey: "awaiting_checkin",
  },
];

const CONFIGURE_TILES: HubTile[] = [
  {
    href: "/visit-bookings/slots",
    labelKey: "hub.slots",
    icon: LayoutGrid,
    tint: "bg-gradient-to-br from-teal-400 to-teal-600",
    perm: "visits.manage_catalog",
  },
  {
    href: "/visit-bookings/departments",
    labelKey: "hub.departments",
    icon: Layers,
    tint: "bg-gradient-to-br from-sky-400 to-blue-500",
    perm: "visits.manage_catalog",
  },
  {
    href: "/visit-bookings/branches",
    labelKey: "hub.branches",
    icon: Share2,
    tint: "bg-gradient-to-br from-slate-400 to-slate-500",
    perm: "visits.manage_catalog",
  },
  {
    href: "/visit-bookings/reports",
    labelKey: "hub.reports",
    icon: BarChart3,
    tint: "bg-gradient-to-br from-lime-500 to-green-600",
  },
];

function TileIcon({ Icon, tint, count }: { Icon: LucideIcon; tint: string; count?: number }) {
  return (
    <span className="relative inline-flex">
      <span
        className={cn(
          "inline-flex h-14 w-14 items-center justify-center rounded-2xl shadow-sm",
          tint,
        )}
      >
        <Icon className="h-6 w-6 text-white" />
      </span>
      {count != null && count > 0 ? (
        <span className="absolute -end-2 -top-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-card px-1.5 text-[10px] font-bold text-foreground shadow ring-1 ring-border">
          {count > 999 ? "999+" : count}
        </span>
      ) : null}
    </span>
  );
}

export function VisitsHubShell() {
  const t = useTranslations("pages.visitBookings");
  const { can } = useAuth();

  const { data } = useQuery({
    queryKey: queryKeys.visits.list({ hub: true }),
    queryFn: () => fetchAdminVisitsList({ limit: 1 }),
  });
  const kpi = data?.kpi;
  const counts: Record<NonNullable<HubTile["countKey"]>, number> = {
    upcoming: kpi?.upcoming ?? 0,
    today: kpi?.today ?? 0,
    awaiting_checkin: kpi?.awaiting_checkin ?? 0,
  };

  const manageTiles = MANAGE_TILES.filter((tile) => !tile.perm || can(tile.perm));
  const configureTiles = CONFIGURE_TILES.filter((tile) => !tile.perm || can(tile.perm));

  return (
    <AppPage>
      <AppPageHeader title={t("title")} description={t("hub.subtitle")} />

      <h2 className="pt-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("hub.manageHeading")}
      </h2>
      <div className="mx-auto grid grid-cols-3 gap-4 pt-3 sm:gap-6">
        {manageTiles.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className="flex flex-col items-center gap-2 rounded-xl p-2 text-center transition-colors hover:bg-muted/40"
          >
            <TileIcon
              Icon={tile.icon}
              tint={tile.tint}
              count={tile.countKey ? counts[tile.countKey] : undefined}
            />
            <span className="text-xs font-medium text-foreground">{t(tile.labelKey)}</span>
          </Link>
        ))}
      </div>

      {configureTiles.length > 0 ? (
        <>
          <h2 className="mt-6 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("hub.configureHeading")}
          </h2>
          <div className="mx-auto grid grid-cols-2 gap-4 pt-3 sm:grid-cols-4 sm:gap-6">
            {configureTiles.map((tile) => (
              <Link
                key={tile.href}
                href={tile.href}
                className="flex flex-col items-center gap-2 rounded-xl p-2 text-center transition-colors hover:bg-muted/40"
              >
                <TileIcon Icon={tile.icon} tint={tile.tint} />
                <span className="text-xs font-medium text-foreground">{t(tile.labelKey)}</span>
              </Link>
            ))}
          </div>
        </>
      ) : null}
    </AppPage>
  );
}
