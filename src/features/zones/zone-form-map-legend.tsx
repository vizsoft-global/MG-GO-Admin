"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { normalizeZoneColor } from "./zone-colors";
import type { ZoneRow } from "./types";

const MAX_LEGEND_ROWS = 5;

export function ZoneFormMapLegend({
  zones,
  onZoneSelect,
  onViewAll,
  className,
}: {
  zones: ZoneRow[];
  onZoneSelect?: (zoneId: string) => void;
  onViewAll?: () => void;
  className?: string;
}) {
  const t = useTranslations("pages.zones.geofence");
  const visible = zones.slice(0, MAX_LEGEND_ROWS);
  const total = zones.length;

  return (
    <div
      className={cn(
        "flex w-56 flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3 shadow-md dark:border-slate-700 dark:bg-slate-900",
        className,
      )}
    >
      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
        {t("geofenceLegend")}
      </p>
      {visible.length === 0 ? (
        <p className="py-1 text-[11px] text-slate-500 dark:text-slate-400">
          {t("geofenceListEmpty")}
        </p>
      ) : (
        <ul className="space-y-1">
          {visible.map((zone) => (
            <li key={zone.id}>
              <button
                type="button"
                onClick={() => onZoneSelect?.(zone.id)}
                disabled={!onZoneSelect}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-start text-xs text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-default disabled:hover:bg-transparent dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: normalizeZoneColor(zone.color) }}
                />
                <span className="truncate">{zone.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {total > 0 && onViewAll ? (
        <button
          type="button"
          onClick={onViewAll}
          className="mt-1 cursor-pointer text-start text-[11px] font-medium text-primary hover:underline"
        >
          {t("viewAllZones", { count: total })}
        </button>
      ) : null}
    </div>
  );
}
