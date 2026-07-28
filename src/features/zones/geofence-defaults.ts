import type { GeofenceKind, ZoneGeofenceSettings, ZoneRow } from "./types";

export const DEFAULT_GEOFENCE_SETTINGS: ZoneGeofenceSettings = {
  geofence_kind: "inclusion",
  status: "active",
  description: null,
  alert_on_entry: true,
  alert_on_exit: true,
  alert_on_dwell: false,
  dwell_time_seconds: 300,
  assign_to_all_drivers: true,
  driver_group_label: null,
  notify_in_app: true,
  notify_email: false,
  notify_sms: false,
};

type SettingsRow = Partial<ZoneGeofenceSettings> | null | undefined;

export function mergeZoneGeofenceSettings(
  settings: SettingsRow,
): ZoneGeofenceSettings {
  return {
    ...DEFAULT_GEOFENCE_SETTINGS,
    ...(settings ?? {}),
  };
}

export function normalizeZoneRow<T extends {
  id: string;
  name: string;
  code: string;
  color: string;
  zone_type: ZoneRow["zone_type"];
  geometry: ZoneRow["geometry"];
  created_at: string;
  zone_geofence_settings?: SettingsRow | SettingsRow[] | null;
}>(
  z: T,
  driverCount: number,
): ZoneRow {
  const raw = z.zone_geofence_settings;
  const settingsRow = Array.isArray(raw) ? raw[0] : raw;
  const settings = mergeZoneGeofenceSettings(settingsRow ?? undefined);

  return {
    id: z.id,
    name: z.name,
    code: z.code,
    color: z.color,
    zone_type: z.zone_type,
    geometry: z.geometry,
    created_at: z.created_at,
    driver_count: driverCount,
    ...settings,
  };
}

export function geofenceKindLabelKey(kind: GeofenceKind): "inclusion" | "exclusion" {
  return kind;
}
