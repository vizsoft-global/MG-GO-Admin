"use client";

import { CircleMarker, Tooltip } from "react-leaflet";
import { useDriverLocationsRealtime } from "@/features/locations/use-driver-locations-realtime";
import {
  DEFAULT_ZONE_MAP_PREFS,
  loadZoneMapPrefs,
  subscribeZoneMapPrefs,
} from "./zone-map-layer-prefs";
import { useEffect, useState } from "react";

export function ZoneLiveDriversLeaflet() {
  const { locations } = useDriverLocationsRealtime();
  const [showLiveDrivers, setShowLiveDrivers] = useState(
    DEFAULT_ZONE_MAP_PREFS.showLiveDrivers,
  );

  useEffect(() => {
    setShowLiveDrivers(loadZoneMapPrefs().showLiveDrivers);
    return subscribeZoneMapPrefs((prefs) => setShowLiveDrivers(prefs.showLiveDrivers));
  }, []);

  if (!showLiveDrivers) return null;

  return (
    <>
      {locations.map((loc) => (
        <CircleMarker
          key={loc.driverId}
          center={[loc.latitude, loc.longitude]}
          radius={8}
          pathOptions={{
            color: "#ffffff",
            weight: 2,
            fillColor:
              loc.pinStatus === "alert"
                ? "#dc2626"
                : loc.pinStatus === "active"
                  ? "#16a34a"
                  : "#ca8a04",
            fillOpacity: 0.95,
          }}
        >
          <Tooltip direction="top" offset={[0, -4]}>
            {loc.driverName} · {loc.trackingStatus}
          </Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}
