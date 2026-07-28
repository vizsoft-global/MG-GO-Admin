"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  getGoogleMapsLoadFailure,
  loadGoogleMaps,
  type GoogleMapsApi,
} from "@/lib/google-maps/load";
import { GoogleMapsStatusBanner } from "./google-maps-status-banner";
import { DEFAULT_MAP_ZOOM, KUWAIT_MAP_CENTER } from "@/features/zones/constants";
import type { RestaurantLocation } from "./restaurant-location-utils";

function tupleToLatLng(center: [number, number]) {
  return { lat: center[0], lng: center[1] };
}

export function RestaurantLocationPickerInner({
  value,
  onChange,
  defaultCenter = KUWAIT_MAP_CENTER,
  className,
  keyMissingHint,
}: {
  value: RestaurantLocation | null;
  onChange: (next: RestaurantLocation | null) => void;
  defaultCenter?: [number, number];
  className?: string;
  keyMissingHint?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("@/lib/google-maps/load").GoogleMapInstance | null>(
    null,
  );
  const markerRef = useRef<
    import("@/lib/google-maps/load").GoogleMarkerInstance | null
  >(null);
  const googleRef = useRef<GoogleMapsApi | null>(null);
  const onChangeRef = useRef(onChange);
  const [mapState, setMapState] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );

  onChangeRef.current = onChange;

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    loadGoogleMaps().then((google) => {
      if (cancelled || !container) return;
      if (!google?.maps?.Map) {
        setMapState("unavailable");
        return;
      }

      googleRef.current = google;
      const center = value
        ? { lat: value.lat, lng: value.lng }
        : tupleToLatLng(defaultCenter);
      const zoom = value ? 16 : DEFAULT_MAP_ZOOM;

      const map = new google.maps.Map(container, {
        center,
        zoom,
        disableDefaultUI: true,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
      });
      mapRef.current = map;

      google.maps.event.addListener(map, "click", (e) => {
        const latLng = e.latLng;
        if (!latLng) return;
        const lat = latLng.lat();
        const lng = latLng.lng();
        onChangeRef.current({ lat, lng });
      });

      if (value) {
        const marker = new google.maps.Marker({
          position: { lat: value.lat, lng: value.lng },
          map,
          draggable: true,
        });
        marker.addListener("dragend", () => {
          const pos = marker.getPosition();
          if (pos) {
            onChangeRef.current({ lat: pos.lat(), lng: pos.lng() });
          }
        });
        markerRef.current = marker;
      }

      setMapState("ready");
    });

    return () => {
      cancelled = true;
      const google = googleRef.current;
      if (google && markerRef.current) {
        google.maps.event.clearInstanceListeners(markerRef.current);
        markerRef.current.setMap(null);
        markerRef.current = null;
      }
      if (google && mapRef.current) {
        google.maps.event.clearInstanceListeners(mapRef.current);
        mapRef.current = null;
      }
      googleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- map mounts once per container
  }, []);

  useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !map || mapState !== "ready") return;

    if (value) {
      const pos = { lat: value.lat, lng: value.lng };
      map.panTo(pos);
      map.setZoom(16);

      if (markerRef.current) {
        markerRef.current.setPosition(pos);
      } else {
        const marker = new google.maps.Marker({
          position: pos,
          map,
          draggable: true,
        });
        marker.addListener("dragend", () => {
          const p = marker.getPosition();
          if (p) {
            onChangeRef.current({ lat: p.lat(), lng: p.lng() });
          }
        });
        markerRef.current = marker;
      }
    } else {
      if (markerRef.current) {
        google.maps.event.clearInstanceListeners(markerRef.current);
        markerRef.current.setMap(null);
        markerRef.current = null;
      }
      map.panTo(tupleToLatLng(defaultCenter));
      map.setZoom(DEFAULT_MAP_ZOOM);
    }
  }, [value, defaultCenter, mapState]);

  if (mapState === "unavailable") {
    const failure = getGoogleMapsLoadFailure();
    return (
      <div
        className={
          className ??
          "flex h-full w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6"
        }
      >
        <GoogleMapsStatusBanner className="max-w-md text-center" />
        {!failure ? (
          <p className="text-center text-xs text-muted-foreground">
            {keyMissingHint ??
              "Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to enable the map and place search."}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={className ?? "relative h-full w-full"}>
      <div ref={containerRef} className="h-full w-full" />
      {mapState === "loading" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-muted">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : null}
    </div>
  );
}
