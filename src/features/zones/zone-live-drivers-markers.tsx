"use client";

import { useEffect, useRef } from "react";
import { loadGoogleMaps } from "@/lib/google-maps/load";
import type { GoogleMapInstance, GoogleMarkerInstance } from "@/lib/google-maps/load";
import { driverPinIcon } from "@/features/locations/driver-pin-icon";
import { useDriverLocationsRealtime } from "@/features/locations/use-driver-locations-realtime";

export function useGoogleLiveDriverMarkers(
  map: GoogleMapInstance | null,
  enabled: boolean,
) {
  const { locations } = useDriverLocationsRealtime();
  const markersRef = useRef<GoogleMarkerInstance[]>([]);

  useEffect(() => {
    if (!map || !enabled) {
      for (const m of markersRef.current) m.setMap(null);
      markersRef.current = [];
      return;
    }

    let cancelled = false;

    void loadGoogleMaps().then((google) => {
      if (cancelled || !google?.maps?.Marker || !map) return;

      const MarkerCtor = google.maps.Marker;

      for (const m of markersRef.current) m.setMap(null);
      markersRef.current = [];

      for (const loc of locations) {
        const marker = new MarkerCtor({
          position: { lat: loc.latitude, lng: loc.longitude },
          map,
          title: `${loc.driverName} · ${loc.trackingStatus}`,
          icon: driverPinIcon({
            pinStatus: loc.pinStatus,
            trackingStatus: loc.trackingStatus,
            heading: loc.heading,
          }),
        });
        markersRef.current.push(marker);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [map, enabled, locations]);
}
