"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { loadGoogleMaps } from "@/lib/google-maps/load";
import type { ZoneMapAdapter } from "./zone-map-adapter";
import type { ZoneMapDrawMode } from "./zone-map-inner";
import type { ZoneGeoFeature, ZoneGeometryType } from "@/lib/geo/zone-geometry";
import type { ZoneRow } from "./types";

const ZoneMapInnerDynamic = dynamic(
  () => import("./zone-map-inner").then((m) => m.ZoneMapInner),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center rounded-xl bg-muted">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

const ZoneMapGoogleInnerDynamic = dynamic(
  () => import("./zone-map-google-inner").then((m) => m.ZoneMapGoogleInner),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center rounded-xl bg-muted">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

export type ZoneMapProvider = "loading" | "google" | "leaflet";

export type ZoneMapProps = {
  zones: ZoneRow[];
  selectedId: string | null;
  className?: string;
  drawMode?: ZoneMapDrawMode;
  excludeZoneId?: string | null;
  draftGeometry?: ZoneGeoFeature | null;
  draftZoneType?: ZoneGeometryType;
  draftCircleRadiusMeters?: number;
  draftColor?: string;
  onDraftGeometryChange?: (
    geometry: ZoneGeoFeature | null,
    zoneType: ZoneGeometryType,
  ) => void;
  onMapReady?: (adapter: ZoneMapAdapter) => void;
  onZoneSelect?: (zoneId: string) => void;
};

export function ZoneMap(props: ZoneMapProps) {
  const [provider, setProvider] = useState<ZoneMapProvider>("loading");

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then((api) => {
      if (cancelled) return;
      setProvider(api?.maps?.Map && api.maps.drawing ? "google" : "leaflet");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (provider === "loading") {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-xl bg-muted">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (provider === "google") {
    return <ZoneMapGoogleInnerDynamic {...props} />;
  }

  const { onMapReady, ...leafletProps } = props;
  return (
    <ZoneMapInnerDynamic
      {...leafletProps}
      onMapAdapterReady={onMapReady}
    />
  );
}
