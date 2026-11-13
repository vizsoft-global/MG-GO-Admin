"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Activity, MapPinned, ShieldAlert, ShieldCheck } from "lucide-react";
import { MetricTile, type Tone } from "@/components/ui/metric-tile";
import { cn } from "@/lib/utils";
import type { GeofenceKind, ZoneRow } from "./types";

export type ZoneSummaryCardKey = "total" | "active" | "inclusion" | "exclusion";

export function ZoneGeofencesSummary({
  zones,
  compact = false,
  activeKey = "total",
  onSelect,
}: {
  zones: ZoneRow[];
  compact?: boolean;
  activeKey?: ZoneSummaryCardKey;
  onSelect?: (key: ZoneSummaryCardKey) => void;
}) {
  const t = useTranslations("pages.zones");

  const stats = useMemo(() => {
    const active = zones.filter((z) => z.status === "active").length;
    const inclusion = zones.filter((z) => z.geofence_kind === "inclusion").length;
    const exclusion = zones.filter((z) => z.geofence_kind === "exclusion").length;
    return { total: zones.length, active, inclusion, exclusion };
  }, [zones]);

  const cards: Array<{
    key: ZoneSummaryCardKey;
    label: string;
    value: number;
    tone: Tone;
    icon: typeof MapPinned;
  }> = [
    {
      key: "total",
      label: t("geofence.summaryTotal"),
      value: stats.total,
      tone: "primary",
      icon: MapPinned,
    },
    {
      key: "active",
      label: t("geofence.summaryActive"),
      value: stats.active,
      tone: "success",
      icon: Activity,
    },
    {
      key: "inclusion",
      label: t("geofence.summaryInclusion"),
      value: stats.inclusion,
      tone: "success",
      icon: ShieldCheck,
    },
    {
      key: "exclusion",
      label: t("geofence.summaryExclusion"),
      value: stats.exclusion,
      tone: "danger",
      icon: ShieldAlert,
    },
  ];

  return (
    <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4")}>
      {cards.map((card) => (
        <MetricTile
          key={card.key}
          label={card.label}
          value={card.value}
          tone={card.tone}
          icon={card.icon}
          selected={Boolean(onSelect) && activeKey === card.key}
          onClick={onSelect ? () => onSelect(card.key) : undefined}
          ariaLabel={card.label}
          disabled={!onSelect}
          className={compact ? "min-h-[76px] p-2.5 [&_p:last-of-type]:text-xl" : undefined}
        />
      ))}
    </div>
  );
}

export type ZoneCardFilter = "all" | "active";

export function zoneMatchesCardFilter(
  zone: ZoneRow,
  kindFilter: "all" | GeofenceKind,
  cardFilter: ZoneCardFilter,
): boolean {
  if (!zoneMatchesKindFilter(zone, kindFilter)) return false;
  if (cardFilter === "active") return zone.status === "active";
  return true;
}

export function zoneMatchesKindFilter(
  zone: ZoneRow,
  kindFilter: "all" | GeofenceKind,
): boolean {
  if (kindFilter === "all") return true;
  return zone.geofence_kind === kindFilter;
}
