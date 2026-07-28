import type {
  ZoneGeoFeature,
  ZoneGeometryType,
} from "@/lib/geo/zone-geometry";
import type { RestaurantStatus } from "./restaurant-status";

export type { RestaurantStatus };

export type RestaurantGeofenceKind = "inclusion" | "exclusion";

export type RestaurantListStats = {
  active_deliveries: number;
  deliveries_total: number;
  deliveries_verified: number;
  deliveries_cancelled: number;
  has_coordinates: boolean;
  geofence_count: number;
};

export type RestaurantRow = {
  id: string;
  partner_id: string | null;
  partner_name: string;
  zone_id: string | null;
  zone_name: string;
  name: string;
  logo_url: string | null;
  logo_display_url: string | null;
  external_merchant_id: string | null;
  map_link: string | null;
  latitude: number | null;
  longitude: number | null;
  status: RestaurantStatus;
  is_active: boolean;
  driver_count: number;
  created_at: string;
} & RestaurantListStats;

export type RestaurantDeliveryStats = {
  active_deliveries: number;
  deliveries_total: number;
  deliveries_verified: number;
  deliveries_cancelled: number;
  cancelled_today: number;
};

export type RestaurantDetailModel = RestaurantRow & {
  geofence_count: number;
  has_coordinates: boolean;
  delivery_stats: RestaurantDeliveryStats;
};

export type RestaurantDriverLinkStatus = "linked" | "intake";

export type RestaurantAssignedDriver = {
  id: string;
  driver_id: string | null;
  intake_id: string | null;
  name: string;
  driver_code: string;
  phone: string | null;
  link_status: RestaurantDriverLinkStatus;
  is_on_duty: boolean;
};

export type RestaurantActivityKind =
  | "pickup"
  | "in_transit"
  | "delivered"
  | "cancelled";

export type RestaurantActivityEvent = {
  at: string;
  kind: RestaurantActivityKind;
  delivery_id: string;
  short_id: string;
  driver_name: string;
  driver_code: string;
  external_order_id: string | null;
  status: import("@/features/deliveries/types").DeliveryStatus;
  cancel_reason?: string | null;
};

export type RestaurantPartnerOption = {
  id: string;
  name: string;
};

export type RestaurantZoneOption = {
  id: string;
  name: string;
  code: string;
};

export type RestaurantGeofence = {
  id: string;
  restaurant_id: string;
  kind: RestaurantGeofenceKind;
  zone_type: ZoneGeometryType;
  geometry: ZoneGeoFeature;
  name: string | null;
  color: string;
  created_at: string;
};

/** Client-side geofence row (temp id allowed before first save). */
export type RestaurantGeofenceDraft = {
  id: string;
  kind: RestaurantGeofenceKind;
  zone_type: ZoneGeometryType;
  geometry: ZoneGeoFeature;
  name: string | null;
  color: string;
};

export type RestaurantGeofenceInput = {
  id?: string;
  kind: RestaurantGeofenceKind;
  zone_type: ZoneGeometryType;
  geometry: ZoneGeoFeature;
  name?: string | null;
  color?: string;
};

export type RestaurantMutationResult = {
  error?: string;
  errorDetail?: string;
  success?: boolean;
  id?: string;
  logoUrl?: string | null;
  logoWarning?: string;
  geofenceError?: string;
  /** Server may downgrade status when restaurant has no pin or inclusion zone. */
  statusWarning?: "auto_downgraded_to_draft";
  /** Final status persisted (after possible auto-downgrade). */
  finalStatus?: RestaurantStatus;
};

export type RestaurantGeofenceMutationResult = {
  error?: string;
  success?: boolean;
};
