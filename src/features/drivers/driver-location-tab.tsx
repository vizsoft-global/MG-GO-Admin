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
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import {
  GroupTableHeaderRow,
  groupRows,
  useGroupedListView,
} from "@/components/app/app-list-controls";
import {
  EmptyCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { ArchiveLoadPrompt } from "@/features/locations/archive-load-prompt";
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

  const [archiveDay, setArchiveDay] = useState<string | null>(null);
  const loadArchive = archiveDay === date;
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["driver-location-history", profileDriverId, date, loadArchive],
    queryFn: () => {
      const { from, to } = dayBounds(date);
      return fetchDriverLocationHistory(profileDriverId, from, to, { archive: loadArchive });
    },
    enabled: Boolean(profileDriverId),
  });
  const events = useMemo(() => data?.events ?? [], [data]);

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
  const eventColumns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "time", label: t("colTime") },
      { id: "status", label: t("colStatus"), categorical: true },
      { id: "zone", label: t("colZone"), categorical: true },
      { id: "accuracy", label: t("colAccuracy") },
      { id: "delivery", label: t("colDelivery") },
    ],
    [t],
  );
  const prefs = useTablePrefs(`driver-location-${profileDriverId}`, eventColumns);
  const filteredEvents = useMemo(() => {
    const query = prefs.appliedQuery.trim().toLowerCase();
    if (!query) return events;
    return events.filter((event) =>
      [eventStatusLabel(event), zoneLabel(event.zoneStatus), event.deliveryId ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [eventStatusLabel, events, prefs.appliedQuery, zoneLabel]);
  const groupedEvents = useMemo(
    () =>
      groupRows(
        filteredEvents,
        prefs.groupBy,
        {
          status: (event) => eventStatusLabel(event),
          zone: (event) => zoneLabel(event.zoneStatus),
        },
        {},
        "—",
      ),
    [eventStatusLabel, filteredEvents, prefs.groupBy, zoneLabel],
  );
  const listView = useGroupedListView(
    groupedEvents,
    prefs.groupBy !== "none",
    `${prefs.groupBy}\u0001${prefs.appliedQuery}\u0001${date}`,
  );
  const shownColumns = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));

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
          {data?.archiveRequired ? (
            <ArchiveLoadPrompt
              day={date}
              loading={isFetching}
              onConfirm={() => setArchiveDay(date)}
            />
          ) : null}
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
          ) : (
            <AppDataTable
              toolbar={
                <TableToolbar
                  prefs={prefs}
                  entity={t("eventsTitle")}
                  columns={eventColumns}
                  rowKind="dynamic"
                  filteredCount={filteredEvents.length}
                  totalCount={events.length}
                />
              }
              columns={shownColumns.map((column) => ({ id: column.id, label: column.label }))}
              empty={
                filteredEvents.length === 0 ? (
                  <AppDataTableEmpty>{t("noEvents")}</AppDataTableEmpty>
                ) : undefined
              }
            >
              {listView.sections.flatMap((section) => [
                section.showHeader ? (
                  <GroupTableHeaderRow
                    key={`g-${section.key}`}
                    colSpan={shownColumns.length}
                    label={section.label}
                    total={section.total}
                    open={section.open}
                    page={section.page}
                    showPager={section.showPager}
                    onToggle={() => listView.toggle(section.key)}
                    onStep={(dir) => listView.step(section.key, dir)}
                  />
                ) : null,
                ...section.visibleRows.map((event) => (
                  <AppDataTableRow key={event.id}>
                    {shownColumns.map((column) => {
                      switch (column.id) {
                        case "time":
                          return (
                            <TableCell key={column.id} className="text-sm">
                              {new Date(event.recordedAt).toLocaleTimeString()}
                            </TableCell>
                          );
                        case "status":
                          return (
                            <TableCell key={column.id} className="text-sm">
                              <StatusPill variant={statusVariantForEvent(event)}>
                                {eventStatusLabel(event)}
                              </StatusPill>
                            </TableCell>
                          );
                        case "zone":
                          return (
                            <TableCell key={column.id} className="text-sm">
                              {event.zoneStatus ? zoneLabel(event.zoneStatus) : <EmptyCell />}
                            </TableCell>
                          );
                        case "accuracy":
                          return (
                            <TableCell key={column.id} className="text-sm">
                              {event.accuracyMeters != null ? (
                                `${Math.round(event.accuracyMeters)} m`
                              ) : (
                                <EmptyCell />
                              )}
                            </TableCell>
                          );
                        case "delivery":
                          return (
                            <TableCell key={column.id} className="text-sm">
                              {event.deliveryId ? (
                                <Link
                                  href={`/deliveries?highlight=${event.deliveryId}`}
                                  className="text-primary hover:underline"
                                >
                                  {t("viewDelivery")}
                                </Link>
                              ) : (
                                <EmptyCell />
                              )}
                            </TableCell>
                          );
                        default:
                          return null;
                      }
                    })}
                  </AppDataTableRow>
                )),
              ])}
            </AppDataTable>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
