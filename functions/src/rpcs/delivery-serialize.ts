import { isoTimestamp, numberOrNull, type Dict } from "./_shared";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function serializeDelivery(id: string, raw: Dict): Dict {
  const proofUrls = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return {
    id,
    driver_id: asString(raw["driver_id"]),
    partner_id: asString(raw["partner_id"]),
    zone_id: asString(raw["zone_id"]),
    restaurant_id: asString(raw["restaurant_id"]),
    external_order_id: typeof raw["external_order_id"] === "string" ? raw["external_order_id"] : null,
    status: asString(raw["status"]),
    pickup_at: isoTimestamp(raw["pickup_at"]),
    pickup_lat: numberOrNull(raw["pickup_lat"]),
    pickup_lng: numberOrNull(raw["pickup_lng"]),
    pickup_proof_url: asString(raw["pickup_proof_url"]),
    pickup_proof_urls: proofUrls(raw["pickup_proof_urls"]),
    delivered_at: isoTimestamp(raw["delivered_at"]),
    delivered_lat: numberOrNull(raw["delivered_lat"]),
    delivered_lng: numberOrNull(raw["delivered_lng"]),
    order_proof_url: asString(raw["order_proof_url"]),
    order_proof_urls: proofUrls(raw["order_proof_urls"]),
    cancelled_at: isoTimestamp(raw["cancelled_at"]),
    cancel_lat: numberOrNull(raw["cancel_lat"]),
    cancel_lng: numberOrNull(raw["cancel_lng"]),
    cancel_reason: asString(raw["cancel_reason"]),
    cancel_proof_url: asString(raw["cancel_proof_url"]),
    cancel_proof_urls: proofUrls(raw["cancel_proof_urls"]),
    rejection_reason: asString(raw["rejection_reason"]),
    shift_date: typeof raw["shift_date"] === "string" ? raw["shift_date"].slice(0, 10) : null,
    created_at: isoTimestamp(raw["created_at"]),
    updated_at: isoTimestamp(raw["updated_at"]),
  };
}
