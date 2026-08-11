"use client";

import {
  Building2,
  CalendarDays,
  ClipboardList,
  DoorOpen,
  Layers,
  List,
  PieChart,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { AppPage, AppPageHeader } from "@/components/app";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";

type HubTile = {
  href: string;
  labelKey: string;
  hintKey: string;
  icon: typeof List;
  perm?: "visits.operate" | "visits.manage_catalog";
};

const TILES: HubTile[] = [
  {
    href: "/visit-bookings/all",
    labelKey: "hub.allVisits",
    hintKey: "hub.allVisitsHint",
    icon: List,
  },
  {
    href: "/visit-bookings/calendar",
    labelKey: "hub.calendar",
    hintKey: "hub.calendarHint",
    icon: CalendarDays,
  },
  {
    href: "/visit-bookings/reception",
    labelKey: "hub.reception",
    hintKey: "hub.receptionHint",
    icon: DoorOpen,
    perm: "visits.operate",
  },
  {
    href: "/visit-bookings/slots",
    labelKey: "hub.slots",
    hintKey: "hub.slotsHint",
    icon: Layers,
    perm: "visits.manage_catalog",
  },
  {
    href: "/visit-bookings/departments",
    labelKey: "hub.departments",
    hintKey: "hub.departmentsHint",
    icon: ClipboardList,
    perm: "visits.manage_catalog",
  },
  {
    href: "/visit-bookings/branches",
    labelKey: "hub.branches",
    hintKey: "hub.branchesHint",
    icon: Building2,
    perm: "visits.manage_catalog",
  },
  {
    href: "/visit-bookings/reports",
    labelKey: "hub.reports",
    hintKey: "hub.reportsHint",
    icon: PieChart,
  },
];

export function VisitsHubShell() {
  const t = useTranslations("pages.visitBookings");
  const { can } = useAuth();
  const visible = TILES.filter((tile) => !tile.perm || can(tile.perm));

  return (
    <AppPage>
      <AppPageHeader title={t("title")} description={t("hub.subtitle")} />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visible.map((tile) => {
          const Icon = tile.icon;
          return (
            <Link
              key={tile.href}
              href={tile.href}
              className={cn(
                "flex min-h-[88px] flex-col justify-between rounded-xl border border-border bg-card p-4 shadow-sm",
                "transition-colors hover:border-primary/40 hover:bg-primary/5",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold">{t(tile.labelKey)}</span>
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
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
