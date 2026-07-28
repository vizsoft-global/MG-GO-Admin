import { GEOFENCE_COLORS } from "@/lib/ui/map-colors";
import type { RestaurantGeofenceKind } from "./types";

export function defaultGeofenceColor(kind: RestaurantGeofenceKind): string {
  return kind === "inclusion" ? GEOFENCE_COLORS.inclusion : GEOFENCE_COLORS.exclusion;
}
