import type { ZoneGeoFeature, ZoneGeometryType } from "@/lib/geo/zone-geometry";

export type GeofenceKind = "inclusion" | "exclusion";

export type GeofenceMapOverlay = {
  id: string;
  name?: string;
  driverCount?: number;
  zone_type: ZoneGeometryType;
  geometry: ZoneGeoFeature;
  geofence_kind: GeofenceKind;
  color: string;
  status: "active" | "inactive" | "draft";
};

export function geofenceOverlayColor(kind: GeofenceKind): string {
  return kind === "exclusion" ? "#ef4444" : "#22c55e";
}

export function geofenceFillOpacity(status: GeofenceMapOverlay["status"]): number {
  if (status === "inactive" || status === "draft") return 0.08;
  return 0.22;
}
