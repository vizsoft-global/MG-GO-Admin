import {
  RESTAURANT_STATUSES,
  type RestaurantStatus,
  isActiveFromRestaurantStatus,
} from "./restaurant-status";

function parseOptionalCoord(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : Number.NaN;
}

export function parseRestaurantFormData(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const partnerId = String(formData.get("partnerId") ?? "").trim();
  const zoneId = String(formData.get("zoneId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const externalMerchantId = String(formData.get("externalMerchantId") ?? "").trim();
  const mapLink = String(formData.get("mapLink") ?? "").trim();
  const statusRaw = String(formData.get("status") ?? "draft").trim();
  const latitude = parseOptionalCoord(String(formData.get("latitude") ?? ""));
  const longitude = parseOptionalCoord(String(formData.get("longitude") ?? ""));
  const inclusionRaw = Number(formData.get("inclusionGeofenceCount") ?? 0);
  const inclusionGeofenceCount =
    Number.isFinite(inclusionRaw) && inclusionRaw > 0 ? Math.floor(inclusionRaw) : 0;

  const status = RESTAURANT_STATUSES.includes(statusRaw as RestaurantStatus)
    ? (statusRaw as RestaurantStatus)
    : "draft";

  return {
    id,
    partnerId,
    zoneId,
    name,
    externalMerchantId,
    mapLink,
    status,
    isActive: isActiveFromRestaurantStatus(status),
    latitude,
    longitude,
    inclusionGeofenceCount,
  };
}

export function validateRestaurantCoordinates(
  latitude: number | null,
  longitude: number | null,
): "invalid_coordinates" | null {
  const hasLat = latitude != null;
  const hasLng = longitude != null;

  if (!hasLat && !hasLng) return null;

  if (!hasLat || !hasLng) return "invalid_coordinates";
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return "invalid_coordinates";
  if (latitude < -90 || latitude > 90) return "invalid_coordinates";
  if (longitude < -180 || longitude > 180) return "invalid_coordinates";

  return null;
}
