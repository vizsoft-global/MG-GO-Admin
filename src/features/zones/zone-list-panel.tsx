"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, UserPlus, Users } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pill, StatusDot } from "@/components/ui/metric-tile";
import { Button } from "@/components/ui/button";
import { formatZoneArea, zoneAreaSqKm } from "@/lib/geo/zone-area";
import { cn } from "@/lib/utils";
import type { GeofenceKind, ZoneRow } from "./types";

const PAGE_SIZE = 20;

function formatCreatedAt(value: string, locale: string) {
  try {
    const date = new Date(value);
    return {
      date: new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(date),
      time: new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
      }).format(date),
    };
  } catch {
    return { date: value.slice(0, 10), time: "--:--" };
  }
}

export function ZoneListPanel({
  zones,
  chips,
  kindFilter,
  selectedId,
  isLoading,
  onKindFilterChange,
  onSelect,
  onEdit,
  onAssignDrivers,
  canAssignDrivers = false,
}: {
  zones: ZoneRow[];
  chips: Array<{ id: "all" | GeofenceKind; label: string }>;
  kindFilter: "all" | GeofenceKind;
  selectedId: string | null;
  isLoading: boolean;
  onKindFilterChange: (value: "all" | GeofenceKind) => void;
  onSelect: (id: string) => void;
  onEdit: (zone: ZoneRow) => void;
  onAssignDrivers?: (zone: ZoneRow) => void;
  canAssignDrivers?: boolean;
}) {
  const t = useTranslations("pages.zones");
  const locale = useLocale();
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLTableRowElement>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [zones, kindFilter]);

  const visibleZones = zones.slice(0, visibleCount);
  const hasMore = visibleCount < zones.length;

  useEffect(() => {
    const root = scrollRef.current;
    const target = loadMoreRef.current;
    if (!root || !target || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((count) => Math.min(count + PAGE_SIZE, zones.length));
        }
      },
      { root, rootMargin: "120px", threshold: 0 },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, zones.length, visibleCount]);

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="shrink-0 border-b border-slate-200 px-3 py-2.5 dark:border-slate-700">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => onKindFilterChange(chip.id)}
                className={cn(
                  "cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  kindFilter === chip.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted/50",
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
          <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-300">
            {zones.length}
          </span>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-white dark:bg-slate-900">
            <TableRow className="border-slate-200 dark:border-slate-700">
              <TableHead>{t("geofence.colName")}</TableHead>
              <TableHead>{t("geofence.colType")}</TableHead>
              <TableHead>{t("geofence.colArea")}</TableHead>
              <TableHead>{t("geofence.colStatus")}</TableHead>
              <TableHead className="text-end">{t("geofence.colDrivers")}</TableHead>
              <TableHead>{t("geofence.colCreated")}</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-16 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />
                </TableCell>
              </TableRow>
            ) : visibleZones.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-16 text-center text-sm text-slate-500 dark:text-slate-300"
                >
                  {t("emptyTitle")}
                </TableCell>
              </TableRow>
            ) : (
              <>
                {visibleZones.map((zone) => {
                  const areaLabel = formatZoneArea(zoneAreaSqKm(zone.zone_type, zone.geometry));
                  const created = formatCreatedAt(zone.created_at, locale);
                  const selected = selectedId === zone.id;
                  const typeTone = zone.geofence_kind === "inclusion" ? "success" : "danger";

                  return (
                    <TableRow
                      key={zone.id}
                      className={cn(
                        "cursor-pointer border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40",
                        selected && "border-l-2 border-l-blue-600 bg-blue-50/40 dark:bg-blue-500/10",
                      )}
                      onClick={() => onSelect(zone.id)}
                      onDoubleClick={() => onEdit(zone)}
                      title={t("geofence.doubleClickToEdit")}
                    >
                      <TableCell>
                        <div className="inline-flex items-start gap-2">
                          <StatusDot tone={typeTone} className="mt-1" />
                          <span>
                            <span className="block font-medium text-slate-900 dark:text-slate-100">
                              {zone.name}
                            </span>
                            <span className="text-xs text-slate-500 dark:text-slate-300">
                              {zone.code}
                            </span>
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Pill tone={typeTone}>{t(`geofence.kind.${zone.geofence_kind}`)}</Pill>
                      </TableCell>
                      <TableCell className="tabular-nums text-slate-700 dark:text-slate-200">
                        {areaLabel}
                      </TableCell>
                      <TableCell>
                        <Pill tone={zone.status === "active" ? "success" : "neutral"}>
                          {t(`geofence.status.${zone.status}`)}
                        </Pill>
                      </TableCell>
                      <TableCell className="text-end" onClick={(e) => e.stopPropagation()}>
                        <span className="inline-flex items-center justify-end gap-1 tabular-nums text-sm font-medium text-slate-800 dark:text-slate-100">
                          {canAssignDrivers && onAssignDrivers ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="h-7 w-7 shrink-0 cursor-pointer"
                              onClick={() => onAssignDrivers(zone)}
                              aria-label={t("assignDrivers")}
                            >
                              <UserPlus className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                          <Users className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                          {zone.driver_count}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="block text-xs text-slate-700 dark:text-slate-200">
                          {created.date}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-300">
                          {created.time}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {hasMore ? (
                  <TableRow ref={loadMoreRef} className="hover:bg-transparent">
                    <TableCell colSpan={6} className="py-4 text-center">
                      <Loader2 className="mx-auto h-4 w-4 animate-spin text-slate-400" />
                    </TableCell>
                  </TableRow>
                ) : null}
              </>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="shrink-0 border-t border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-300">
        <p>{t("geofence.showingCount", { shown: visibleZones.length, total: zones.length })}</p>
        <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-400">
          {t("geofence.doubleClickToEdit")}
        </p>
      </div>
    </aside>
  );
}
