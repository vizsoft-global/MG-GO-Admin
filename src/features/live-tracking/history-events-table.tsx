"use client";

import { useMemo } from "react";
import { Bike, Package, Pause } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pill, type Tone } from "@/components/ui/metric-tile";
import {
  locationEventStatusKey,
  locationEventStatusMessageKey,
} from "@/features/locations/location-event-display";
import type { DriverLocationEvent } from "@/features/locations/types";
import { formatBatteryPct, formatSpeedMps } from "@/features/locations/location-status";
import {
  EmptyCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { TrackingGlassCard } from "./tracking-shell";
import { cn } from "@/lib/utils";

export function HistoryEventsTable({
  events,
  currentIndex,
  onSelectIndex,
  formatTime,
}: {
  events: DriverLocationEvent[];
  currentIndex: number;
  onSelectIndex: (index: number) => void;
  formatTime: (iso: string) => string;
}) {
  const t = useTranslations("pages.liveTracking");
  const tLoc = useTranslations("pages.locations");
  const toolbarColumns = useMemo((): TableToolbarColumn[] => [
    { id: "time", label: t("colTime") },
    { id: "tracking", label: t("colTrackingStatus") },
    { id: "zone", label: t("colZoneStatus") },
    { id: "speed", label: t("colSpeed") },
    { id: "battery", label: t("colBattery") },
    { id: "accuracy", label: t("colAccuracy") },
    { id: "delivery", label: t("colDelivery") },
  ], [t]);
  const prefs = useTablePrefs("live-tracking-history-events", toolbarColumns);
  const shown = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));

  const trackingStatusLabel = (event: DriverLocationEvent) => {
    const key = locationEventStatusKey(event);
    return tLoc(locationEventStatusMessageKey(key));
  };

  const statusTone = (event: DriverLocationEvent): Tone => {
    const key = locationEventStatusKey(event);
    if (key === "pickup" || key === "delivered" || key === "moving") return "success";
    if (key === "cancelled") return "danger";
    if (key === "delivery_checkin") return "warning";
    return "neutral";
  };

  const query = prefs.appliedQuery.trim().toLowerCase();
  const rows = query
    ? events.filter((event) =>
        [formatTime(event.recordedAt), trackingStatusLabel(event), event.zoneStatus ?? "", event.deliveryId ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(query),
      )
    : events;

  return (
    <TrackingGlassCard className="overflow-hidden border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="text-sm font-semibold text-foreground">{t("tabHistory")}</h3>
        <Pill tone="neutral">{t("historyEventsCount", { count: events.length })}</Pill>
      </div>
      <div className="max-h-[280px] overflow-auto">
        <TableToolbar
          prefs={prefs}
          entity={t("tabHistory")}
          columns={toolbarColumns}
          rowKind="dynamic"
          filteredCount={rows.length}
          totalCount={events.length}
        />
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              {shown.map((column) => (
                <TableHead key={column.id} className={TABLE_HEAD_CLASS}>{column.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((event) => {
              const index = events.indexOf(event);
              return (
              <TableRow
                key={event.id}
                className={cn(
                  "cursor-pointer text-xs",
                  index === currentIndex && "bg-emerald-50/60 ring-1 ring-inset ring-emerald-200",
                )}
                onClick={() => onSelectIndex(index)}
              >
                {shown.map((column) => {
                  if (column.id === "time") {
                    return <TableCell key={column.id} className="font-mono text-xs">{formatTime(event.recordedAt)}</TableCell>;
                  }
                  if (column.id === "tracking") {
                    return (
                      <TableCell key={column.id} className="text-xs">
                        <span className="inline-flex items-center gap-1.5">
                          {event.trackingStatus === "delivery_submit" ? (
                            <Package className="h-3.5 w-3.5 text-blue-600" />
                          ) : event.trackingStatus === "moving" ? (
                            <Bike className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <Pause className="h-3.5 w-3.5 text-slate-500" />
                          )}
                          <Pill tone={statusTone(event)}>{trackingStatusLabel(event)}</Pill>
                        </span>
                      </TableCell>
                    );
                  }
                  if (column.id === "zone") {
                    return (
                      <TableCell key={column.id} className="text-xs">
                        {event.zoneStatus ? t(`zoneStatus.${event.zoneStatus}`) : <EmptyCell />}
                      </TableCell>
                    );
                  }
                  if (column.id === "speed") {
                    return <TableCell key={column.id} className="text-xs">{formatSpeedMps(event.speedMps)}</TableCell>;
                  }
                  if (column.id === "battery") {
                    return <TableCell key={column.id} className="text-xs">{formatBatteryPct(event.batteryPct)}</TableCell>;
                  }
                  if (column.id === "accuracy") {
                    return (
                      <TableCell key={column.id} className="text-xs">
                        {event.accuracyMeters != null ? `±${event.accuracyMeters.toFixed(0)} m` : <EmptyCell />}
                      </TableCell>
                    );
                  }
                  return (
                    <TableCell key={column.id} className="text-xs">
                      {event.deliveryId ? (
                        <Link href={`/deliveries?highlight=${event.deliveryId}`} className="text-primary hover:underline">
                          {t("viewDelivery")}
                        </Link>
                      ) : (
                        <EmptyCell />
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </TrackingGlassCard>
  );
}
