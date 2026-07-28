"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { DriverLocationsMap } from "@/features/locations/driver-locations-map";
import {
  locationEventStatusKey,
  locationEventStatusMessageKey,
} from "@/features/locations/location-event-display";
import { fetchDriverLocationHistory } from "@/features/locations/locations-actions";
import type { DriverLocationEvent, ZoneStatus } from "@/features/locations/types";
import { useDriverLocationsRealtime } from "@/features/locations/use-driver-locations-realtime";
import type { StatusVariant } from "@/lib/ui/resolve-status-variant";

const KUWAIT_TZ = "Asia/Kuwait";

function kuwaitToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: KUWAIT_TZ }).format(new Date());
}

function dayBounds(date: string): { from: string; to: string } {
  return {
    from: `${date}T00:00:00+03:00`,
    to: `${date}T23:59:59.999+03:00`,
  };
}

function statusVariantForEvent(event: DriverLocationEvent): StatusVariant {
  const key = locationEventStatusKey(event);
  if (key === "pickup" || key === "delivered") return "success";
  if (key === "cancelled") return "danger";
  if (key === "moving") return "success";
  if (key === "delivery_checkin") return "warning";
  return "neutral";
}

export function DriverLocationTab({
  profileDriverId,
  driverName,
}: {
  profileDriverId: string;
  driverName: string;
}) {
  const t = useTranslations("pages.driverDetail.location");
  const tLoc = useTranslations("pages.locations");
  const [date, setDate] = useState(kuwaitToday());
  const { locations } = useDriverLocationsRealtime();

  const live = useMemo(
    () => locations.find((l) => l.driverId === profileDriverId) ?? null,
    [locations, profileDriverId],
  );

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["driver-location-history", profileDriverId, date],
    queryFn: () => {
      const { from, to } = dayBounds(date);
      return fetchDriverLocationHistory(profileDriverId, from, to);
    },
    enabled: Boolean(profileDriverId),
  });

  const path = useMemo(
    () => events.map((e) => ({ lat: e.latitude, lng: e.longitude })),
    [events],
  );

  const markers = useMemo(() => {
    const list: Array<{
      id: string;
      lat: number;
      lng: number;
      title?: string;
      highlight?: boolean;
      pinStatus?: "active" | "idle" | "alert";
    }> = [];

    if (live) {
      list.push({
        id: "live",
        lat: live.latitude,
        lng: live.longitude,
        title: `${driverName} (live)`,
        pinStatus: live.pinStatus,
      });
    }

    for (const e of events) {
      if (e.trackingStatus === "delivery_submit") {
        const actionKey = locationEventStatusKey(e);
        list.push({
          id: e.id,
          lat: e.latitude,
          lng: e.longitude,
          title: tLoc(locationEventStatusMessageKey(actionKey)),
          highlight: true,
        });
      }
    }

    return list;
  }, [events, live, driverName, tLoc]);

  const zoneLabel = (zone: ZoneStatus | null) => {
    if (!zone) return "—";
    return tLoc(`zoneStatus.${zone}`);
  };

  const eventStatusLabel = (event: DriverLocationEvent) => {
    const key = locationEventStatusKey(event);
    return tLoc(locationEventStatusMessageKey(key));
  };

  return (
    <div className="space-y-4">
      <Card className="rounded-xl border-border shadow-sm">
        <CardHeader className="flex flex-col gap-4 border-b border-border py-4 sm:flex-row sm:items-end sm:justify-between">
          <CardTitle className="text-base font-semibold">{t("title")}</CardTitle>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="location-date" className="text-xs text-muted-foreground">
              {t("dateLabel")}
            </Label>
            <Input
              id="location-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 w-full cursor-pointer rounded-lg sm:w-44"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4 py-4">
          {live ? (
            <p className="text-xs text-muted-foreground">
              {t("livePosition")}: {live.latitude.toFixed(5)}, {live.longitude.toFixed(5)} ·{" "}
              {t("lastSeen")} {new Date(live.lastSeenAt).toLocaleTimeString()}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">{t("noLivePosition")}</p>
          )}
          <DriverLocationsMap markers={markers} path={path} mapHeightClass="h-64" />
        </CardContent>
      </Card>

      <Card className="rounded-xl border-border shadow-sm">
        <CardHeader className="border-b border-border py-4">
          <CardTitle className="text-sm font-semibold">{t("eventsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : events.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">{t("noEvents")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colTime")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colZone")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colAccuracy")}</TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>{t("colDelivery")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event: DriverLocationEvent) => (
                  <TableRow key={event.id} className="hover:bg-muted/40">
                    <TableCell className="text-sm">
                      {new Date(event.recordedAt).toLocaleTimeString()}
                    </TableCell>
                    <TableCell className="text-sm">
                      <StatusPill variant={statusVariantForEvent(event)}>
                        {eventStatusLabel(event)}
                      </StatusPill>
                    </TableCell>
                    <TableCell className="text-sm">{zoneLabel(event.zoneStatus)}</TableCell>
                    <TableCell className="text-sm">
                      {event.accuracyMeters != null
                        ? `${Math.round(event.accuracyMeters)} m`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {event.deliveryId ? (
                        <Link
                          href={`/deliveries?highlight=${event.deliveryId}`}
                          className="text-primary hover:underline"
                        >
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
