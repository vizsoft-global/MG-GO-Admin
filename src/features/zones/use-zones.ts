"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/query/query-keys";
import type { ZoneGeoFeature } from "@/lib/geo/zone-geometry";
import { normalizeZoneColor } from "./zone-colors";
import { normalizeZoneRow } from "./geofence-defaults";
import type { ZoneDriverRow, ZoneRow } from "./types";

const ZONES_WITH_GEOFENCE_SELECT = `
  id,
  name,
  code,
  color,
  zone_type,
  geometry,
  created_at,
  zone_geofence_settings (
    geofence_kind,
    status,
    description,
    alert_on_entry,
    alert_on_exit,
    alert_on_dwell,
    dwell_time_seconds,
    assign_to_all_drivers,
    driver_group_label,
    notify_in_app,
    notify_email,
    notify_sms
  )
`;

export async function fetchZones(): Promise<ZoneRow[]> {
  const supabase = createClient();

  const primary = await supabase
    .from("zones")
    .select(ZONES_WITH_GEOFENCE_SELECT)
    .order("name");

  let zones: Array<{
    id: string;
    name: string;
    code: string;
    color: string;
    zone_type: "polygon" | "circle";
    geometry: unknown;
    created_at: string;
    zone_geofence_settings?: unknown;
  }> = (primary.data ?? []) as Array<{
    id: string;
    name: string;
    code: string;
    color: string;
    zone_type: "polygon" | "circle";
    geometry: unknown;
    created_at: string;
    zone_geofence_settings?: unknown;
  }>;

  if (primary.error) {
    const fallback = await supabase
      .from("zones")
      .select("id, name, code, color, zone_type, geometry, created_at")
      .order("name");
    if (fallback.error) throw new Error(fallback.error.message);
    zones = (fallback.data ?? []) as Array<{
      id: string;
      name: string;
      code: string;
      color: string;
      zone_type: "polygon" | "circle";
      geometry: unknown;
      created_at: string;
      zone_geofence_settings?: unknown;
    }>;
  }

  const { data: drivers, error: driversError } = await supabase
    .from("drivers")
    .select("zone_id");

  if (driversError) throw new Error(driversError.message);

  const countByZone = new Map<string, number>();
  for (const row of drivers ?? []) {
    if (!row.zone_id) continue;
    countByZone.set(row.zone_id, (countByZone.get(row.zone_id) ?? 0) + 1);
  }

  return (zones ?? []).map((z) =>
    normalizeZoneRow(
      {
        ...z,
        color: normalizeZoneColor(z.color),
        geometry: z.geometry as ZoneGeoFeature | null,
        zone_geofence_settings: z.zone_geofence_settings as
          | Parameters<typeof normalizeZoneRow>[0]["zone_geofence_settings"]
          | undefined,
      },
      countByZone.get(z.id) ?? 0,
    ),
  );
}

export async function fetchZoneDrivers(zoneId: string): Promise<ZoneDriverRow[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("drivers")
    .select("id, driver_code, partner_id")
    .eq("zone_id", zoneId)
    .order("driver_code");

  if (error) throw new Error(error.message);
  if (!data?.length) return [];

  const driverIds = data.map((d) => d.id);
  const partnerIds = [...new Set(data.map((d) => d.partner_id).filter(Boolean))] as string[];

  const [{ data: profiles }, { data: partners }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").in("id", driverIds),
    partnerIds.length > 0
      ? supabase.from("partners").select("id, name, logo_url").in("id", partnerIds)
      : Promise.resolve({ data: [] as { id: string; name: string; logo_url: string | null }[] }),
  ]);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const partnerMap = new Map((partners ?? []).map((p) => [p.id, p]));

  return data.map((row) => {
    const partner = row.partner_id ? partnerMap.get(row.partner_id) : null;
    return {
      id: row.id,
      driver_code: row.driver_code,
      full_name: profileMap.get(row.id) ?? null,
      partner_name: partner?.name ?? null,
      partner_logo_url: partner?.logo_url ?? null,
    };
  });
}

export function useZonesList() {
  return useQuery({
    queryKey: queryKeys.zones.list(),
    queryFn: fetchZones,
  });
}

export function useZoneDrivers(zoneId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.zones.drivers(zoneId ?? ""),
    queryFn: () => fetchZoneDrivers(zoneId!),
    enabled: Boolean(zoneId) && enabled,
  });
}
