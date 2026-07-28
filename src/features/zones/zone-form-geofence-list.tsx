"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { List, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { normalizeZoneColor } from "./zone-colors";
import type { ZoneRow } from "./types";

export function ZoneFormGeofenceList({
  zones,
  onZoneSelect,
  className,
}: {
  zones: ZoneRow[];
  onZoneSelect?: (zoneId: string) => void;
  className?: string;
}) {
  const t = useTranslations("pages.zones.geofence");
  const tZones = useTranslations("pages.zones.placeholders");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return zones;
    return zones.filter((z) => {
      if (z.name.toLowerCase().includes(term)) return true;
      if (z.code.toLowerCase().includes(term)) return true;
      return false;
    });
  }, [zones, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        className={cn(
          "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-md transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800",
          className,
        )}
      >
        <List className="h-3.5 w-3.5" />
        <span>{t("openGeofenceList")}</span>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-72 p-2">
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tZones("searchZones")}
              className="h-8 rounded-lg ps-8 text-xs"
              autoFocus
            />
          </div>
          <ul className="max-h-64 space-y-0.5 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-2 py-3 text-center text-xs text-muted-foreground">
                {t("geofenceListEmpty")}
              </li>
            ) : (
              filtered.map((zone) => (
                <li key={zone.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onZoneSelect?.(zone.id);
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-start hover:bg-muted"
                  >
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: normalizeZoneColor(zone.color) }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-foreground">
                        {zone.name}
                      </span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        #{zone.code}
                      </span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}
