export type TrackingStatus = "idle" | "moving" | "delivery_submit";

/** Resolved action when tracking_status is delivery_submit (from delivery timestamps). */
export type LocationSubmitAction = "pickup" | "delivered" | "cancelled";

export type ZoneStatus = "in_zone" | "out_of_zone" | "unknown";

export type PinStatus = "active" | "idle" | "alert";

export type DriverLiveLocation = {
  driverId: string;
  driverName: string;
  driverCode: string;
  employeeId: string | null;
  isOnDuty: boolean;
  isBlocked: boolean;
  restaurantName: string | null;
  vehicleType: "bike" | "car";
  latitude: number;
  longitude: number;
  speedMps: number | null;
  distanceTodayMeters: number;
  accuracyMeters: number | null;
  batteryPct: number | null;
  heading: number | null;
  trackingStatus: TrackingStatus;
  zoneStatus: ZoneStatus | null;
  activeDeliveryId: string | null;
  lastSeenAt: string;
  updatedAt: string;
  /**
   * Metres travelled since the previous fix we saw for this driver.
   *
   * Resolved by `enrichLiveLocation` from the row it is replacing, and `null` on the very first
   * fix of a session (there is nothing to subtract from). It exists so the list, the popup and
   * the sub-label can apply the app's own `speed or >= 15 m displacement` motion rule instead of
   * trusting `speedMps`, which a coarse network fix leaves at 0.
   */
  movedMeters?: number | null;
  pinStatus: PinStatus;
};

export type DriverLocationEvent = {
  id: string;
  driverId: string;
  latitude: number;
  longitude: number;
  speedMps: number | null;
  accuracyMeters: number | null;
  batteryPct: number | null;
  headingDeg?: number | null;
  altitudeM?: number | null;
  networkType?: string | null;
  chargingState?: string | null;
  isMocked?: boolean | null;
  locationProvider?: string | null;
  activeDeliveryId?: string | null;
  trackingStatus: TrackingStatus;
  zoneStatus: ZoneStatus | null;
  deliveryId: string | null;
  recordedAt: string;
  /** Set on history rows when delivery_submit is matched to pickup/deliver/cancel time. */
  submitAction?: LocationSubmitAction | null;
};

export type RestaurantMapMarker = {
  id: string;
  lat: number;
  lng: number;
  title?: string;
};

export type DriverLocationMapMarker = {
  id: string;
  lat: number;
  lng: number;
  title?: string;
  pinStatus?: PinStatus;
  trackingStatus?: TrackingStatus;
  vehicleType?: "bike" | "car";
  heading?: number | null;
  highlight?: boolean;
};

export type DriverLocationMapPath = {
  lat: number;
  lng: number;
}[];
