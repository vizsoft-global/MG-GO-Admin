"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Activity, MapPinned, ShieldAlert, ShieldCheck } from "lucide-react";
import { MetricTile, type Tone } from "@/components/ui/metric-tile";
import { cn } from "@/lib/utils";
import type { GeofenceKind, ZoneRow } from "./types";

export function ZoneGeofencesSummary({
  zones,
  compact = false,
}: {
  zones: ZoneRow[];
  compact?: boolean;
}) {
  const t = useTranslations("pages.zones");

  const stats = useMemo(() => {
    const active = zones.filter((z) => z.status === "active").length;
    const inclusion = zones.filter((z) => z.geofence_kind === "inclusion").length;
    const exclusion = zones.filter((z) => z.geofence_kind === "exclusion").length;
    return { total: zones.length, active, inclusion, exclusion };
  }, [zones]);

  const cards: Array<{
    label: string;
    value: number;
    tone: Tone;
    icon: typeof MapPinned;
  }> = [
    {
      label: t("geofence.summaryTotal"),
      value: stats.total,
      tone: "primary",
      icon: MapPinned,
    },
    {
      label: t("geofence.summaryActive"),
      value: stats.active,
      tone: "success",
      icon: Activity,
    },
    {
      label: t("geofence.summaryInclusion"),
      value: stats.inclusion,
      tone: "success",
      icon: ShieldCheck,
    },
    {
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
          key={card.label}
          label={card.label}
          value={card.value}
          tone={card.tone}
          icon={card.icon}
          className={compact ? "min-h-[76px] p-2.5 [&_p:last-of-type]:text-xl" : undefined}
        />
      ))}
    </div>
  );
}

export function zoneMatchesKindFilter(
  zone: ZoneRow,
  kindFilter: "all" | GeofenceKind,
): boolean {
  if (kindFilter === "all") return true;
  return zone.geofence_kind === kindFilter;
}
