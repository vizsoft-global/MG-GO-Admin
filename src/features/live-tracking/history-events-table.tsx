"use client";

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

  return (
    <TrackingGlassCard className="overflow-hidden border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="text-sm font-semibold text-foreground">{t("tabHistory")}</h3>
        <Pill tone="neutral">{t("historyEventsCount", { count: events.length })}</Pill>
      </div>
      <div className="max-h-[280px] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colTime")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colTrackingStatus")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colZoneStatus")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colSpeed")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colBattery")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colAccuracy")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colDelivery")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event, index) => (
              <TableRow
                key={event.id}
                className={cn(
                  "cursor-pointer text-xs",
                  index === currentIndex && "bg-emerald-50/60 ring-1 ring-inset ring-emerald-200",
                )}
                onClick={() => onSelectIndex(index)}
              >
                <TableCell className="font-mono text-xs">{formatTime(event.recordedAt)}</TableCell>
                <TableCell className="text-xs">
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
                <TableCell className="text-xs">
                  {event.zoneStatus ? t(`zoneStatus.${event.zoneStatus}`) : "—"}
                </TableCell>
                <TableCell className="text-xs">{formatSpeedMps(event.speedMps)}</TableCell>
                <TableCell className="text-xs">{formatBatteryPct(event.batteryPct)}</TableCell>
                <TableCell className="text-xs">
                  {event.accuracyMeters != null ? `±${event.accuracyMeters.toFixed(0)} m` : "—"}
                </TableCell>
                <TableCell className="text-xs">
                  {event.deliveryId ? (
                    <Link href={`/deliveries?highlight=${event.deliveryId}`} className="text-primary hover:underline">
                      {t("viewDelivery")}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </TrackingGlassCard>
  );
}
