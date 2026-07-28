"use server";

import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import {
  suggestZoneCode,
  validateZoneGeometry,
  type ZoneGeoFeature,
  type ZoneGeometryType,
} from "@/lib/geo/zone-geometry";
import type { Json } from "@/types/database";
import { DEFAULT_GEOFENCE_SETTINGS } from "./geofence-defaults";
import { mapZoneDbError } from "./zone-errors";
import { normalizeZoneColor } from "./zone-colors";
import type { ZoneGeofenceSettings } from "./types";

export type ZoneGeofenceInput = ZoneGeofenceSettings;

function geofenceSettingsPayload(settings: ZoneGeofenceInput) {
  return {
    geofence_kind: settings.geofence_kind,
    status: settings.status,
    description: settings.description?.trim() || null,
    alert_on_entry: settings.alert_on_entry,
    alert_on_exit: settings.alert_on_exit,
    alert_on_dwell: settings.alert_on_dwell,
    dwell_time_seconds: settings.dwell_time_seconds,
    assign_to_all_drivers: settings.assign_to_all_drivers,
    driver_group_label: settings.driver_group_label?.trim() || null,
    notify_in_app: settings.notify_in_app,
    notify_email: settings.notify_email,
    notify_sms: settings.notify_sms,
    updated_at: new Date().toISOString(),
  };
}

async function upsertZoneGeofenceSettings(
  supabase: Awaited<ReturnType<typeof createClient>>,
  zoneId: string,
  settings: ZoneGeofenceInput,
) {
  const { error } = await supabase.from("zone_geofence_settings").upsert(
    {
      zone_id: zoneId,
      ...geofenceSettingsPayload(settings),
    },
    { onConflict: "zone_id" },
  );
  if (error) throw error;
}

async function requireZonesManager() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "zones.manage", session.isSuperAdmin)
  ) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

export type ZoneMutationResult = { error?: string; success?: boolean; id?: string };

export async function createZone(input: {
  name: string;
  code: string;
  color: string;
  zone_type: ZoneGeometryType;
  geometry: ZoneGeoFeature;
  geofence?: Partial<ZoneGeofenceInput>;
}): Promise<ZoneMutationResult> {
  const auth = await requireZonesManager();
  if ("error" in auth) return auth;

  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();
  if (!name || !code) return { error: "missing_fields" };

  const geometryError = validateZoneGeometry(input.zone_type, input.geometry);
  if (geometryError) return { error: geometryError };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("zones")
    .insert({
      name,
      code,
      color: normalizeZoneColor(input.color),
      zone_type: input.zone_type,
      geometry: input.geometry as unknown as Json,
    })
    .select("id")
    .single();

  if (error) {
    return { error: mapZoneDbError(error) };
  }

  const geofence: ZoneGeofenceInput = {
    ...DEFAULT_GEOFENCE_SETTINGS,
    ...(input.geofence ?? {}),
  };

  try {
    await upsertZoneGeofenceSettings(supabase, data.id, geofence);
  } catch (settingsError) {
    await supabase.from("zones").delete().eq("id", data.id);
    return { error: mapZoneDbError(settingsError as { message: string }) };
  }

  void logAdminMutation({
    action: "create",
    entityType: "zone",
    entityId: data.id,
    routeName: "createZone",
    after: {
      name,
      code,
      geofence_kind: geofence.geofence_kind,
      alert_on_entry: geofence.alert_on_entry,
      alert_on_exit: geofence.alert_on_exit,
    },
  });

  return { success: true, id: data.id };
}

export async function updateZone(input: {
  id: string;
  name: string;
  code: string;
  color: string;
  zone_type: ZoneGeometryType;
  geometry: ZoneGeoFeature;
  geofence?: Partial<ZoneGeofenceInput>;
}): Promise<ZoneMutationResult> {
  const auth = await requireZonesManager();
  if ("error" in auth) return auth;

  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();
  if (!name || !code) return { error: "missing_fields" };

  const geometryError = validateZoneGeometry(input.zone_type, input.geometry);
  if (geometryError) return { error: geometryError };

  const supabase = await createClient();

  const { data: existing, error: existingError } = await supabase
    .from("zones")
    .select("name, code, color, zone_type, geometry")
    .eq("id", input.id)
    .single();

  if (existingError || !existing) {
    return { error: mapZoneDbError(existingError ?? { message: "not_found" }) };
  }

  const { error } = await supabase
    .from("zones")
    .update({
      name,
      code,
      color: normalizeZoneColor(input.color),
      zone_type: input.zone_type,
      geometry: input.geometry as unknown as Json,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id);

  if (error) {
    return { error: mapZoneDbError(error) };
  }

  const geofence: ZoneGeofenceInput = {
    ...DEFAULT_GEOFENCE_SETTINGS,
    ...(input.geofence ?? {}),
  };

  try {
    await upsertZoneGeofenceSettings(supabase, input.id, geofence);
  } catch (settingsError) {
    await supabase
      .from("zones")
      .update({
        name: existing.name,
        code: existing.code,
        color: existing.color,
        zone_type: existing.zone_type,
        geometry: existing.geometry,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id);
    return { error: mapZoneDbError(settingsError as { message: string }) };
  }

  void logAdminMutation({
    action: "update",
    entityType: "zone",
    entityId: input.id,
    routeName: "updateZone",
    after: {
      name,
      code,
      geofence_kind: geofence.geofence_kind,
      status: geofence.status,
    },
  });

  return { success: true, id: input.id };
}

export async function deleteZone(id: string, force = false): Promise<ZoneMutationResult> {
  const auth = await requireZonesManager();
  if ("error" in auth) return auth;

  const supabase = await createClient();

  const { count, error: countError } = await supabase
    .from("drivers")
    .select("id", { count: "exact", head: true })
    .eq("zone_id", id);

  if (countError) return { error: mapZoneDbError(countError) };

  if (!force && (count ?? 0) > 0) return { error: "has_drivers" };

  if (force && (count ?? 0) > 0) {
    const { error: unassignError } = await supabase
      .from("drivers")
      .update({ zone_id: null })
      .eq("zone_id", id);
    if (unassignError) return { error: mapZoneDbError(unassignError) };
  }

  const { error } = await supabase.from("zones").delete().eq("id", id);
  if (error) return { error: mapZoneDbError(error) };

  void logAdminMutation({
    action: "delete",
    entityType: "zone",
    entityId: id,
    routeName: "deleteZone",
    context: { force },
  });

  return { success: true };
}

export async function generateZoneCode(): Promise<{ code: string }> {
  return { code: suggestZoneCode() };
}
