import type { ZoneGeoFeature, ZoneGeometryType } from "@/lib/geo/zone-geometry";

export type GeofenceKind = "inclusion" | "exclusion";
export type GeofenceStatus = "active" | "inactive" | "draft";

export type ZoneGeofenceSettings = {
  geofence_kind: GeofenceKind;
  status: GeofenceStatus;
  description: string | null;
  alert_on_entry: boolean;
  alert_on_exit: boolean;
  alert_on_dwell: boolean;
  dwell_time_seconds: number;
  assign_to_all_drivers: boolean;
  driver_group_label: string | null;
  notify_in_app: boolean;
  notify_email: boolean;
  notify_sms: boolean;
};

export type ZoneRow = {
  id: string;
  name: string;
  code: string;
  color: string;
  zone_type: ZoneGeometryType;
  geometry: ZoneGeoFeature | null;
  created_at: string;
  driver_count: number;
} & ZoneGeofenceSettings;

export type ZoneDriverRow = {
  id: string;
  driver_code: string;
  full_name: string | null;
  partner_name: string | null;
  partner_logo_url: string | null;
};

export type ZoneFormValues = {
  name: string;
  code: string;
  color: string;
  zone_type: ZoneGeometryType;
  geometry: ZoneGeoFeature | null;
  description: string;
  geofence_kind: GeofenceKind;
  status: GeofenceStatus;
  alert_on_entry: boolean;
  alert_on_exit: boolean;
  alert_on_dwell: boolean;
  dwell_time_seconds: number;
  assign_to_all_drivers: boolean;
  driver_group_label: string;
  notify_in_app: boolean;
  notify_email: boolean;
  notify_sms: boolean;
};
