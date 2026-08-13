"use client";

import {
  CalendarCheck,
  DoorOpen,
  FileBarChart,
  Layers,
  Network,
  Table2,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
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
    icon: DoorOpen,
    tint: "bg-teal-600",
    countKey: "upcoming",
  },
  {
    href: "/visit-bookings/calendar",
    labelKey: "hub.calendar",
    icon: CalendarCheck,
    tint: "bg-violet-600",
    countKey: "today",
  },
  {
    href: "/visit-bookings/reception",
    labelKey: "hub.reception",
    icon: UserRoundCheck,
    tint: "bg-orange-600",
    perm: "visits.operate",
    countKey: "awaiting_checkin",
  },
];

const CONFIGURE_TILES: HubTile[] = [
  {
    href: "/visit-bookings/slots",
    labelKey: "hub.slots",
    icon: Table2,
    tint: "bg-teal-700",
    perm: "visits.manage_catalog",
  },
  {
    href: "/visit-bookings/departments",
    labelKey: "hub.departments",
    icon: Layers,
    tint: "bg-cyan-600",
    perm: "visits.manage_catalog",
  },
  {
    href: "/visit-bookings/branches",
    labelKey: "hub.branches",
    icon: Network,
    tint: "bg-slate-500",
    perm: "visits.manage_catalog",
  },
  {
    href: "/visit-bookings/reports",
    labelKey: "hub.reports",
    icon: FileBarChart,
    tint: "bg-lime-600",
  },
];

function HubTileLink({
  tile,
  label,
  count,
}: {
  tile: HubTile;
  label: string;
  count?: number;
}) {
  const Icon = tile.icon;
  return (
    <Link
      href={tile.href}
      className="relative flex h-[148px] w-[112px] flex-col items-center justify-center gap-3 outline-none focus-visible:ring-2 focus-visible:ring-white/60"
    >
      <span
        className={cn(
          "relative inline-flex h-24 w-24 items-center justify-center overflow-hidden rounded-[20px] shadow-[0_8px_16px_rgba(0,0,0,0.3)] transition-transform duration-150 ease-out motion-safe:hover:-translate-y-0.5",
          tile.tint,
        )}
      >
        <span
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-black/15"
        />
        <Icon className="relative h-10 w-10 text-white" strokeWidth={1.6} />
      </span>
      <span className="text-center text-[13px] font-medium text-zinc-100">{label}</span>
      {count != null && count > 0 ? (
        <span className="absolute end-2 top-0 inline-flex items-center justify-center rounded-full border border-amber-200 bg-amber-50 px-[7px] py-0.5 text-xs font-semibold text-amber-700">
          {count > 999 ? "999+" : count}
        </span>
      ) : null}
    </Link>
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

  const groups = [
    {
      id: "manage",
      heading: t("hub.manageHeading"),
      width: "max-w-[631px]",
      tiles: MANAGE_TILES.filter((tile) => !tile.perm || can(tile.perm)),
    },
    {
      id: "configure",
      heading: t("hub.configureHeading"),
      width: "max-w-[780px]",
      tiles: CONFIGURE_TILES.filter((tile) => !tile.perm || can(tile.perm)),
    },
  ].filter((group) => group.tiles.length > 0);

  return (
    <div className="-m-3 flex min-h-[calc(100%+1.5rem)] flex-col items-center gap-8 bg-gradient-to-b from-[#2a2a40] via-[#35354f] via-55% to-[#1f1f32] px-12 pb-10 pt-16">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-[30px] font-semibold text-white">{t("title")}</h1>
        <p className="text-sm text-zinc-300">{t("hub.subtitle")}</p>
      </div>

      {groups.map((group) => (
        <section key={group.id} className="flex flex-col items-center gap-[18px]">
          <h2 className="text-[11px] font-semibold uppercase tracking-[1px] text-zinc-400">
            {group.heading}
          </h2>
          <div
            className={cn(
              "flex flex-wrap items-start justify-center gap-x-5 gap-y-6",
              group.width,
            )}
          >
            {group.tiles.map((tile) => (
              <HubTileLink
                key={tile.href}
                tile={tile}
                label={t(tile.labelKey)}
                count={tile.countKey ? counts[tile.countKey] : undefined}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
