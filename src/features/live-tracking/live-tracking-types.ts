import type { DriverLiveLocation } from "@/features/locations/types";

export type LiveDriverMeta = {
  fullName: string | null;
  driverCode: string | null;
  zoneId: string | null;
  partnerId: string | null;
  zoneName: string | null;
  partnerName: string | null;
  intakeId: string | null;
  phone: string | null;
  detailHref: string | null;
  avatarUrl: string | null;
};

export type LiveTrackingEnrichedDriver = DriverLiveLocation & {
  meta?: LiveDriverMeta;
};

export type LiveRecentDelivery = {
  id: string;
  driverId: string;
  shortId: string;
  status: "pending" | "verified" | "rejected" | "under_review" | "in_transit" | "cancelled";
  partnerName: string;
  deliveredAt: string | null;
};
