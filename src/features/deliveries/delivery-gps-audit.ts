import { haversineMeters } from "@/features/locations/location-status";

export function pickupDeliveryDistanceMeters(
  pickup: { lat: number | null; lng: number | null },
  delivery: { lat: number | null; lng: number | null },
): number | null {
  if (
    pickup.lat == null ||
    pickup.lng == null ||
    delivery.lat == null ||
    delivery.lng == null
  ) {
    return null;
  }
  return haversineMeters(pickup.lat, pickup.lng, delivery.lat, delivery.lng);
}

export function trailPathFromEvents(
  events: Array<{ latitude: number; longitude: number; recordedAt: string }>,
): Array<{ lat: number; lng: number }> {
  return [...events]
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime())
    .filter(
      (e) =>
        Number.isFinite(e.latitude) &&
        Number.isFinite(e.longitude) &&
        !(e.latitude === 0 && e.longitude === 0),
    )
    .map((e) => ({ lat: e.latitude, lng: e.longitude }));
}
