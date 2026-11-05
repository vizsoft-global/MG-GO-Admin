"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { queryKeys } from "@/lib/query/query-keys";
import { kuwaitClockMinutes } from "@/lib/date/kuwait-clock";
import { AppHubShell, type HubGroup, type HubTile } from "@/components/app/app-hub-shell";
import { fetchAdminVisitsList, fetchVisitDepartments } from "./visits-actions";
import { departmentLabel } from "./visit-board";

/**
 * Visit bookings hub — Figma `7267:23538` (BajajCare, "03 · Visit bookings").
 *
 * Layout, colours, spacing and type all come from `AppHubShell`, which Fleet Hub,
 * Payroll Hub and OperationsHub share. What stays here is the part only this hub
 * has: the Figma-exported module glyphs in `public/visit-hub/`, the department
 * pill row, and the live counts behind the stat strip and the reception badge.
 */
type VisitTile = {
  href: string;
  labelKey: string;
  glyph: string;
  perm?: "visits.operate" | "visits.manage_catalog";
  /** Red count chip, drawn only on the tile the design draws it on. */
  badgeKey?: "awaiting_checkin";
  /** Counts the design's stat strip carries; kept for screen readers here. */
  srCountKey?: "upcoming" | "today";
};

const MANAGE_TILES: VisitTile[] = [
  {
    href: "/visit-bookings/all",
    labelKey: "hub.allVisits",
    glyph: "/visit-hub/icon-all-visits.svg",
    srCountKey: "upcoming",
  },
  {
    href: "/visit-bookings/calendar",
    labelKey: "hub.calendar",
    glyph: "/visit-hub/icon-calendar.svg",
    srCountKey: "today",
  },
  {
    href: "/visit-bookings/reception",
    labelKey: "hub.reception",
    glyph: "/visit-hub/icon-reception.svg",
    perm: "visits.operate",
    badgeKey: "awaiting_checkin",
  },
];

const CONFIGURE_TILES: VisitTile[] = [
  {
    href: "/visit-bookings/slots",
    labelKey: "hub.slots",
    glyph: "/visit-hub/icon-slots.svg",
    perm: "visits.manage_catalog",
  },
  {
    href: "/visit-bookings/departments",
    labelKey: "hub.departments",
    glyph: "/visit-hub/icon-departments.svg",
    perm: "visits.manage_catalog",
  },
  {
    href: "/visit-bookings/branches",
    labelKey: "hub.branches",
    glyph: "/visit-hub/icon-branches.svg",
    perm: "visits.manage_catalog",
  },
  {
    href: "/visit-bookings/reports",
    labelKey: "hub.reports",
    glyph: "/visit-hub/icon-reports.svg",
  },
];

function minutesOf(hhmm: string): number {
  const [hours, mins] = hhmm.slice(0, 5).split(":");
  const h = Number(hours);
  const m = Number(mins);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : Number.NaN;
}

/** `13:05` → `1:05 PM`. Latin digits pinned so SSR and the client agree. */
function slotTimeLabel(hhmm: string, locale: string): string {
  const [hours, mins] = hhmm.slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return "—";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-KW" : "en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
    numberingSystem: "latn",
  }).format(new Date(Date.UTC(2026, 0, 1, hours, mins)));
}

export function VisitsHubShell({ today, nowMinutes }: { today: string; nowMinutes: number }) {
  const t = useTranslations("pages.visitBookings");
  const locale = useLocale();
  const { can } = useAuth();

  // The server hands over its Kuwait clock, so the first paint is stable; the
  // minute ticker only ever runs after hydration.
  const [now, setNow] = useState(nowMinutes);
  useEffect(() => {
    const id = window.setInterval(() => setNow(kuwaitClockMinutes()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const { data } = useQuery({
    queryKey: queryKeys.visits.list({ hub: true }),
    queryFn: () => fetchAdminVisitsList({ limit: 1 }),
  });
  const kpi = data?.kpi;

  const { data: departments } = useQuery({
    queryKey: queryKeys.visits.departments(),
    queryFn: fetchVisitDepartments,
  });
  const departmentChips = useMemo(
    () =>
      (departments?.rows ?? [])
        .filter((dept) => dept.is_active)
        .sort((a, b) => a.sort_order - b.sort_order || a.label_en.localeCompare(b.label_en)),
    [departments],
  );

  // "Next visit" is not in the KPI payload, and adding it there would be a Cloud
  // Function change for one string. Today's confirmed rows are one call away, so
  // the earliest remaining slot is read from them.
  const { data: todayRows } = useQuery({
    queryKey: queryKeys.visits.list({ hub: "next", date: today }),
    queryFn: () =>
      fetchAdminVisitsList({ dateFrom: today, dateTo: today, status: "confirmed", limit: 100 }),
  });
  const nextVisit = useMemo(() => {
    const upcoming = (todayRows?.rows ?? [])
      .filter((row) => row.status === "confirmed" && row.slot_start != null)
      .filter((row) => {
        const minutes = minutesOf(row.slot_start ?? "");
        return Number.isFinite(minutes) && minutes >= now;
      })
      .sort((a, b) => (a.slot_start ?? "").localeCompare(b.slot_start ?? ""));
    return upcoming[0]?.slot_start ?? null;
  }, [todayRows, now]);

  const counts = {
    upcoming: kpi?.upcoming ?? 0,
    today: kpi?.today ?? 0,
    awaiting_checkin: kpi?.awaiting_checkin ?? 0,
  };

  function toTile(tile: VisitTile): HubTile {
    const badge = tile.badgeKey ? counts[tile.badgeKey] : undefined;
    const srCount =
      tile.srCountKey === "upcoming"
        ? t("hub.upcomingCount", { count: counts.upcoming })
        : tile.srCountKey === "today"
          ? t("hub.todayCount", { count: counts.today })
          : undefined;
    return {
      href: tile.href,
      label: t(tile.labelKey),
      glyph: tile.glyph,
      badge,
      badgeLabel: badge != null ? t("hub.waitingAtReception") : undefined,
      srCountLabel: srCount,
    };
  }

  const groups: HubGroup[] = [
    {
      id: "manage",
      heading: t("hub.manageHeading"),
      hint: t("hub.manageHint"),
      tiles: MANAGE_TILES.filter((tile) => !tile.perm || can(tile.perm)).map(toTile),
    },
    {
      id: "configure",
      heading: t("hub.configureHeading"),
      hint: t("hub.configureHint"),
      tiles: CONFIGURE_TILES.filter((tile) => !tile.perm || can(tile.perm)).map(toTile),
    },
  ].filter((group) => group.tiles.length > 0);

  return (
    <AppHubShell
      title={t("title")}
      subtitle={t("hub.subtitle")}
      breadcrumbHome={t("hub.breadcrumbHome")}
      titleTile={{ glyph: "/visit-hub/icon-calendar.svg" }}
      stats={[
        {
          icon: "/visit-hub/icon-people.svg",
          value: String(counts.today),
          label: t("hub.visitsToday"),
        },
        {
          icon: "/visit-hub/icon-user-check.svg",
          value: String(counts.awaiting_checkin),
          label: t("hub.waitingAtReception"),
        },
        {
          icon: "/visit-hub/icon-clock.svg",
          value: nextVisit ? slotTimeLabel(nextVisit, locale) : "—",
          label: t("hub.nextVisit"),
        },
      ]}
      pills={{
        heading: t("hub.departmentsHeading"),
        hint: t("hub.departmentsFilterHint"),
        items: [
          { label: t("hub.allDepartments"), href: "/visit-bookings/all", active: true },
          ...departmentChips.map((dept) => ({
            label: departmentLabel(dept, locale),
            href: `/visit-bookings/all?department=${encodeURIComponent(dept.key)}`,
          })),
        ],
      }}
      groups={groups}
    />
  );
}
