"use client";

import { useEffect, useRef } from "react";
import { loadGoogleMaps } from "@/lib/google-maps/load";

export function FuelFillMap({ lat, lng }: { lat: number; lng: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    void loadGoogleMaps().then((api) => {
      if (cancelled || !api || !ref.current) return;
      const map = new api.maps.Map(ref.current, {
        center: { lat, lng },
        zoom: 14,
        disableDefaultUI: true,
        zoomControl: true,
        clickableIcons: false,
        gestureHandling: "cooperative",
      });
      new api.maps.Marker({ position: { lat, lng }, map, title: "Fill location" });
    });
    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  return <div ref={ref} className="h-44 w-full rounded-lg border border-border" />;
}
