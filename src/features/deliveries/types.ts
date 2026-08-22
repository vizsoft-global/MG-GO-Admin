export const DELIVERY_STATUSES = [
  "in_transit",
  "pending",
  "verified",
  "under_review",
  "rejected",
  "cancelled",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Statuses admins may set from the detail sheet. */
export const REVIEWABLE_DELIVERY_STATUSES = [
  "pending",
  "verified",
  "under_review",
  "rejected",
] as const;
export type ReviewableDeliveryStatus = (typeof REVIEWABLE_DELIVERY_STATUSES)[number];

export type DeliveryProofShot = {
  objectKey: string;
  thumbUrl: string | null;
  fullUrl: string | null;
  contentType: string | null;
};

export type DeliveryProofFields = {
  proof_display_url: string | null;
  proof_full_url: string | null;
  proof_content_type: string | null;
};

export type DeliveryListRow = {
  id: string;
  short_id: string;
  driver_id: string;
  driver_name: string;
  driver_code: string;
  driver_employee_id: string;
  driver_phone: string;
  partner_id: string | null;
  partner_name: string;
  partner_logo_url: string | null;
  restaurant_id: string | null;
  restaurant_name: string | null;
  zone_id: string | null;
  zone_name: string;
  status: DeliveryStatus;
  external_order_id: string | null;
  order_proof_url: string | null;
  order_proof_urls?: string[];
  order_proofs: DeliveryProofShot[];
  proof_display_url: string | null;
  proof_full_url: string | null;
  proof_content_type: string | null;
  pickup_at: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  pickup_proof_url: string | null;
  pickup_proof_urls?: string[];
  pickup_proofs: DeliveryProofShot[];
  pickup_proof_display_url: string | null;
  pickup_proof_full_url: string | null;
  pickup_proof_content_type: string | null;
  cancelled_at: string | null;
  cancel_lat: number | null;
  cancel_lng: number | null;
  cancel_reason: string | null;
  cancel_proof_url: string | null;
  cancel_proof_urls?: string[];
  cancel_proofs: DeliveryProofShot[];
  cancel_proof_display_url: string | null;
  cancel_proof_full_url: string | null;
  cancel_proof_content_type: string | null;
  rejection_reason: string | null;
  delivered_at: string | null;
  delivered_lat: number | null;
  delivered_lng: number | null;
  created_at: string;
  /** Latest GPS event for this delivery (mock flag for list badge). */
  gps_is_mocked: boolean | null;
};

export type DeliveryDetailModel = DeliveryListRow;

export type DeliveryActionError =
  | "not_authorized"
  | "invalid_status"
  | "reason_required"
  | "too_many"
  | "update_failed"
  | "delete_failed";

export type DeliveryMapPointKind = "pickup" | "delivered" | "cancelled" | "live";

export type DeliveryMapPoint = {
  lat: number;
  lng: number;
  kind: DeliveryMapPointKind;
};
