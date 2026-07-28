"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { MapPin } from "lucide-react";
import { StatusPill } from "@/components/dashboard/status-pill";
import { DriverLocationsMap } from "@/features/locations/driver-locations-map";
import { presencePinsFromLocations } from "@/features/locations/location-dashboard-helpers";
import { useDriverLocationsRealtime } from "@/features/locations/use-driver-locations-realtime";
import { DashboardWidget } from "./dashboard-widget";

function pinVariant(status: "active" | "idle" | "alert") {
  if (status === "active") return "success" as const;
  if (status === "idle") return "warning" as const;
  return "danger" as const;
}

export function PresenceMapWidget({ locale }: { locale: string }) {
  const t = useTranslations("pages.dashboard");
  const { locations, isLoading } = useDriverLocationsRealtime();

  const pins = useMemo(() => presencePinsFromLocations(locations), [locations]);

  const mapMarkers = useMemo(
    () =>
      pins.map((pin) => ({
        id: pin.id,
        lat: pin.lat,
        lng: pin.lng,
        title: pin.driverName,
        pinStatus: pin.status,
      })),
    [pins],
  );

  return (
    <DashboardWidget title={t("widgetPresenceMap")} href={`/${locale}/zones`}>
      {locations.length === 0 && !isLoading ? (
        <p className="border-b border-border px-4 py-3 text-xs text-muted-foreground">
          {t("noLiveLocations")}
        </p>
      ) : null}
      <DriverLocationsMap
        markers={mapMarkers}
        mapHeightClass="h-48"
        fitToMarkers={locations.length > 0}
        className="rounded-none border-0"
      />
      <ul className="divide-y divide-border">
        {pins.length === 0 && !isLoading ? (
          <li className="px-4 py-6 text-center text-xs text-muted-foreground">
            {t("noLiveLocations")}
          </li>
        ) : null}
        {pins.slice(0, 6).map((pin) => (
          <li key={pin.id} className="flex items-start gap-2 px-4 py-2.5 text-xs">
            <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{pin.driverName}</p>
              <p className="text-muted-foreground">{pin.restaurantName}</p>
              <p className="text-[10px] text-muted-foreground">
                {t("lastSeen")}: {new Date(pin.lastSeenAt).toLocaleTimeString()}
              </p>
            </div>
            <StatusPill variant={pinVariant(pin.status)} dot>
              {t(`pinStatus.${pin.status}`)}
            </StatusPill>
          </li>
        ))}
      </ul>
    </DashboardWidget>
  );
}
