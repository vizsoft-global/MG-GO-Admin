"use server";

import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { resolveDriverAvatarUrl } from "@/lib/storage/driver-avatar-url";
import type {
  AssignDriverRow,
  DriverAssignMutationResult,
} from "./types";

async function requireDriversManage() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "drivers.manage", session.isSuperAdmin)
  ) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

async function syncIntakeRestaurants(
  supabase: Awaited<ReturnType<typeof createClient>>,
  intakeId: string,
  restaurantIds: string[],
) {
  await supabase.from("driver_intake_restaurants").delete().eq("intake_id", intakeId);
  if (restaurantIds.length === 0) return;
  await supabase.from("driver_intake_restaurants").insert(
    restaurantIds.map((restaurant_id) => ({ intake_id: intakeId, restaurant_id })),
  );
}

async function resolveIntakeIdForDriver(
  supabase: Awaited<ReturnType<typeof createClient>>,
  driverId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("driver_intakes")
    .select("id")
    .eq("linked_profile_id", driverId)
    .is("archived_at", null)
    .maybeSingle();
  return data?.id ?? null;
}

async function syncLinkedDriverRestaurants(
  supabase: Awaited<ReturnType<typeof createClient>>,
  driverId: string,
  restaurantIds: string[],
) {
  await syncDriverRestaurants(supabase, driverId, restaurantIds);
  const intakeId = await resolveIntakeIdForDriver(supabase, driverId);
  if (intakeId) {
    await syncIntakeRestaurants(supabase, intakeId, restaurantIds);
  }
}

async function fetchDriverRestaurantIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  driverId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("driver_restaurants")
    .select("restaurant_id")
    .eq("driver_id", driverId);
  return (data ?? []).map((r) => r.restaurant_id);
}

async function syncDriverRestaurants(
  supabase: Awaited<ReturnType<typeof createClient>>,
  driverId: string,
  restaurantIds: string[],
) {
  await supabase.from("driver_restaurants").delete().eq("driver_id", driverId);
  if (restaurantIds.length === 0) return;
  await supabase.from("driver_restaurants").insert(
    restaurantIds.map((restaurant_id) => ({ driver_id: driverId, restaurant_id })),
  );
}

async function validatePublishedRestaurants(
  supabase: Awaited<ReturnType<typeof createClient>>,
  restaurantIds: string[],
): Promise<{ error?: string }> {
  if (restaurantIds.length === 0) return {};
  const { data, error } = await supabase
    .from("restaurants")
    .select("id")
    .eq("status", "published")
    .eq("is_active", true)
    .in("id", restaurantIds);
  if (error) return { error: "save_failed" };
  if ((data ?? []).length !== restaurantIds.length) {
    return { error: "invalid_restaurants" };
  }
  return {};
}

async function driverHasInTransitDelivery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  driverId: string,
): Promise<boolean> {
  const { count, error } = await supabase
    .from("deliveries")
    .select("id", { count: "exact", head: true })
    .eq("driver_id", driverId)
    .filter("status", "eq", "in_transit");
  if (error) return false;
  return (count ?? 0) > 0;
}

async function logAssignmentEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: {
    driverId: string;
    changedBy: string;
    changeType: string;
    zoneIdBefore: string | null;
    zoneIdAfter: string | null;
    restaurantIdsBefore: string[];
    restaurantIdsAfter: string[];
    contextEntityType?: string | null;
    contextEntityId?: string | null;
  },
) {
  await (
    supabase as unknown as {
      from: (table: string) => {
        insert: (row: Record<string, unknown>) => Promise<unknown>;
      };
    }
  )
    .from("driver_assignment_events")
    .insert({
      driver_id: input.driverId,
      changed_by: input.changedBy,
      change_type: input.changeType,
      zone_id_before: input.zoneIdBefore,
      zone_id_after: input.zoneIdAfter,
      restaurant_ids_before: input.restaurantIdsBefore,
      restaurant_ids_after: input.restaurantIdsAfter,
      context_entity_type: input.contextEntityType ?? null,
      context_entity_id: input.contextEntityId ?? null,
    });
}

type DriverCoreRow = {
  id: string;
  driver_code: string;
  partner_id: string | null;
  zone_id: string | null;
  is_on_duty: boolean;
  profiles:
    | { full_name: string | null; phone: string | null; avatar_url: string | null }
    | { full_name: string | null; phone: string | null; avatar_url: string | null }[]
    | null;
  partners: { name: string } | { name: string }[] | null;
  zones: { name: string } | { name: string }[] | null;
};

function relOne<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null;
  return Array.isArray(rel) ? (rel[0] ?? null) : rel;
}

async function enrichAssignDriverRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  driverIds: string[],
): Promise<AssignDriverRow[]> {
  if (driverIds.length === 0) return [];

  const [{ data: drivers, error }, { data: links }, { data: locations }, { data: inTransit }, { data: intakes }] =
    await Promise.all([
      supabase
        .from("drivers")
        .select(
          "id, driver_code, partner_id, zone_id, is_on_duty, profiles(full_name, phone, avatar_url), partners(name), zones(name)",
        )
        .in("id", driverIds),
      supabase.from("driver_restaurants").select("driver_id, restaurant_id").in("driver_id", driverIds),
      supabase
        .from("driver_locations")
        .select("driver_id, latitude, longitude, last_seen_at")
        .in("driver_id", driverIds),
      supabase
        .from("deliveries")
        .select("driver_id")
        .in("driver_id", driverIds)
        .filter("status", "eq", "in_transit"),
      supabase
        .from("driver_intakes")
        .select("id, linked_profile_id, avatar_url")
        .in("linked_profile_id", driverIds)
        .is("archived_at", null),
    ]);

  if (error) throw error;

  const intakeByProfileId = new Map(
    (intakes ?? [])
      .filter((row) => row.linked_profile_id)
      .map((row) => [row.linked_profile_id as string, row]),
  );

  const restaurantIds = [...new Set((links ?? []).map((l) => l.restaurant_id))];
  const { data: restaurants } =
    restaurantIds.length > 0
      ? await supabase.from("restaurants").select("id, name").in("id", restaurantIds)
      : { data: [] as { id: string; name: string }[] };

  const restaurantNameById = new Map((restaurants ?? []).map((r) => [r.id, r.name]));
  const restaurantsByDriver = new Map<string, string[]>();
  for (const link of links ?? []) {
    const list = restaurantsByDriver.get(link.driver_id) ?? [];
    list.push(link.restaurant_id);
    restaurantsByDriver.set(link.driver_id, list);
  }

  const locationByDriver = new Map(
    (locations ?? []).map((l) => [
      l.driver_id,
      {
        latitude: l.latitude != null ? Number(l.latitude) : null,
        longitude: l.longitude != null ? Number(l.longitude) : null,
        last_seen_at: l.last_seen_at,
      },
    ]),
  );

  const inTransitSet = new Set((inTransit ?? []).map((d) => d.driver_id));
  const avatarCache = new Map<string, string | null>();

  return Promise.all(
    (drivers ?? []).map(async (raw) => {
      const row = raw as unknown as DriverCoreRow;
      const profile = relOne(row.profiles);
      const intake = intakeByProfileId.get(row.id);
      const avatarKey = profile?.avatar_url ?? intake?.avatar_url ?? null;
      let avatar_url: string | null = null;
      if (avatarKey) {
        if (avatarCache.has(avatarKey)) {
          avatar_url = avatarCache.get(avatarKey) ?? null;
        } else {
          avatar_url = await resolveDriverAvatarUrl(avatarKey);
          avatarCache.set(avatarKey, avatar_url);
        }
      }

      const restIds = restaurantsByDriver.get(row.id) ?? [];
      const loc = locationByDriver.get(row.id);

      return {
        driver_id: row.id,
        intake_id: intake?.id ?? null,
        name: profile?.full_name ?? "—",
        driver_code: row.driver_code,
        phone: profile?.phone ?? null,
        avatar_url,
        is_on_duty: row.is_on_duty ?? false,
        zone_id: row.zone_id,
        zone_name: relOne(row.zones)?.name ?? null,
        partner_id: row.partner_id,
        partner_name: relOne(row.partners)?.name ?? null,
        restaurant_ids: restIds,
        restaurant_names: restIds.map((id) => restaurantNameById.get(id) ?? id),
        latitude: loc?.latitude ?? null,
        longitude: loc?.longitude ?? null,
        last_seen_at: loc?.last_seen_at ?? null,
        has_in_transit_delivery: inTransitSet.has(row.id),
      };
    }),
  );
}

export async function fetchRestaurantAssignedDriversForAssign(
  restaurantId: string,
): Promise<AssignDriverRow[]> {
  const auth = await requireDriversManage();
  if (auth.error) throw new Error(auth.error);
  if (!restaurantId) return [];

  const supabase = await createClient();
  const { data: linkedRows, error: linkedErr } = await supabase
    .from("driver_restaurants")
    .select("driver_id")
    .eq("restaurant_id", restaurantId);
  if (linkedErr) throw linkedErr;

  const driverIds = [...new Set((linkedRows ?? []).map((row) => row.driver_id))];

  const rows = await enrichAssignDriverRows(supabase, driverIds);
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchZoneAssignedDriversForAssign(
  zoneId: string,
): Promise<AssignDriverRow[]> {
  const auth = await requireDriversManage();
  if (auth.error) throw new Error(auth.error);
  if (!zoneId) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("drivers")
    .select("id")
    .eq("zone_id", zoneId);
  if (error) throw error;

  const driverIds = (data ?? []).map((r) => r.id);
  const rows = await enrichAssignDriverRows(supabase, driverIds);
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function searchDriversForAssign(
  query: string,
  limit = 20,
): Promise<AssignDriverRow[]> {
  const auth = await requireDriversManage();
  if (auth.error) throw new Error(auth.error);

  const supabase = await createClient();
  const term = query.trim();
  if (!term) return [];

  const { data: intakes, error } = await supabase
    .from("driver_intakes")
    .select("linked_profile_id")
    .is("archived_at", null)
    .eq("linked", true)
    .not("linked_profile_id", "is", null)
    .or(
      `full_name.ilike.%${term}%,phone.ilike.%${term}%,driver_code.ilike.%${term}%`,
    )
    .limit(limit);

  if (error) throw error;

  const driverIds = [
    ...new Set(
      (intakes ?? [])
        .map((r) => r.linked_profile_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const rows = await enrichAssignDriverRows(supabase, driverIds);
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchDriverAssignmentPreview(
  driverId: string,
): Promise<AssignDriverRow | null> {
  const auth = await requireDriversManage();
  if (auth.error) throw new Error(auth.error);
  if (!driverId) return null;

  const supabase = await createClient();
  const rows = await enrichAssignDriverRows(supabase, [driverId]);
  return rows[0] ?? null;
}

export async function assignDriverToRestaurant(input: {
  driverId: string;
  restaurantId: string;
  zoneId?: string | null;
  replaceAll?: boolean;
}): Promise<DriverAssignMutationResult> {
  const auth = await requireDriversManage();
  if (auth.error) return { error: auth.error };

  const { driverId, restaurantId, zoneId, replaceAll } = input;
  if (!driverId || !restaurantId) return { error: "missing_fields" };

  const supabase = await createClient();

  const { data: restaurant, error: restaurantErr } = await supabase
    .from("restaurants")
    .select("id, status, is_active, zone_id")
    .eq("id", restaurantId)
    .maybeSingle();
  if (restaurantErr || !restaurant) return { error: "invalid_restaurants" };
  if (restaurant.status !== "published" || !restaurant.is_active) {
    return { error: "invalid_restaurants" };
  }

  const { data: driver, error: driverErr } = await supabase
    .from("drivers")
    .select("id, zone_id")
    .eq("id", driverId)
    .maybeSingle();
  if (driverErr || !driver) return { error: "save_failed" };

  const beforeZoneId = driver.zone_id;
  const beforeRestaurantIds = await fetchDriverRestaurantIds(supabase, driverId);

  let nextRestaurantIds: string[];
  if (replaceAll) {
    nextRestaurantIds = [restaurantId];
  } else if (beforeRestaurantIds.includes(restaurantId)) {
    nextRestaurantIds = beforeRestaurantIds;
  } else {
    nextRestaurantIds = [...beforeRestaurantIds, restaurantId];
  }

  const restaurantCheck = await validatePublishedRestaurants(supabase, nextRestaurantIds);
  if (restaurantCheck.error) return { error: restaurantCheck.error };

  const hasActive = await driverHasInTransitDelivery(supabase, driverId);

  const nextZoneId =
    zoneId !== undefined ? zoneId || null : restaurant.zone_id ?? beforeZoneId;

  if (replaceAll || !beforeRestaurantIds.includes(restaurantId)) {
    await syncLinkedDriverRestaurants(supabase, driverId, nextRestaurantIds);
  }

  if (nextZoneId !== beforeZoneId) {
    const { error: zoneErr } = await supabase
      .from("drivers")
      .update({ zone_id: nextZoneId, updated_at: new Date().toISOString() })
      .eq("id", driverId);
    if (zoneErr) return { error: "save_failed" };
  }

  await logAssignmentEvent(supabase, {
    driverId,
    changedBy: auth.session.id,
    changeType: replaceAll ? "restaurant_replace" : "restaurant_add",
    zoneIdBefore: beforeZoneId,
    zoneIdAfter: nextZoneId,
    restaurantIdsBefore: beforeRestaurantIds,
    restaurantIdsAfter: nextRestaurantIds,
    contextEntityType: "restaurant",
    contextEntityId: restaurantId,
  });

  void logAdminMutation({
    action: "update",
    entityType: "driver",
    entityId: driverId,
    routeName: "assignDriverToRestaurant",
    after: {
      restaurant_id: restaurantId,
      replace_all: replaceAll ?? false,
      zone_id: nextZoneId,
    },
  });

  return {
    success: true,
    ...(hasActive ? { warning: "driver_has_active_delivery" as const } : {}),
  };
}

export async function assignDriverToZone(input: {
  driverId: string;
  zoneId: string;
}): Promise<DriverAssignMutationResult> {
  const auth = await requireDriversManage();
  if (auth.error) return { error: auth.error };

  const { driverId, zoneId } = input;
  if (!driverId || !zoneId) return { error: "missing_fields" };

  const supabase = await createClient();

  const { data: zone, error: zoneErr } = await supabase
    .from("zones")
    .select("id")
    .eq("id", zoneId)
    .maybeSingle();
  if (zoneErr || !zone) return { error: "save_failed" };

  const { data: driver, error: driverErr } = await supabase
    .from("drivers")
    .select("id, zone_id")
    .eq("id", driverId)
    .maybeSingle();
  if (driverErr || !driver) return { error: "save_failed" };

  const beforeZoneId = driver.zone_id;
  const beforeRestaurantIds = await fetchDriverRestaurantIds(supabase, driverId);
  const hasActive = await driverHasInTransitDelivery(supabase, driverId);

  const { error: updateErr } = await supabase
    .from("drivers")
    .update({ zone_id: zoneId, updated_at: new Date().toISOString() })
    .eq("id", driverId);
  if (updateErr) return { error: "save_failed" };

  await logAssignmentEvent(supabase, {
    driverId,
    changedBy: auth.session.id,
    changeType: "zone_assign",
    zoneIdBefore: beforeZoneId,
    zoneIdAfter: zoneId,
    restaurantIdsBefore: beforeRestaurantIds,
    restaurantIdsAfter: beforeRestaurantIds,
    contextEntityType: "zone",
    contextEntityId: zoneId,
  });

  void logAdminMutation({
    action: "update",
    entityType: "driver",
    entityId: driverId,
    routeName: "assignDriverToZone",
    after: { zone_id: zoneId },
  });

  return {
    success: true,
    ...(hasActive ? { warning: "driver_has_active_delivery" as const } : {}),
  };
}

export async function unassignDriverFromRestaurant(input: {
  driverId: string;
  restaurantId: string;
}): Promise<DriverAssignMutationResult> {
  const auth = await requireDriversManage();
  if (auth.error) return { error: auth.error };

  const { driverId, restaurantId } = input;
  if (!driverId || !restaurantId) return { error: "missing_fields" };

  const supabase = await createClient();

  const beforeRestaurantIds = await fetchDriverRestaurantIds(supabase, driverId);
  if (!beforeRestaurantIds.includes(restaurantId)) {
    return { success: true };
  }

  const nextRestaurantIds = beforeRestaurantIds.filter((id) => id !== restaurantId);
  const restaurantCheck = await validatePublishedRestaurants(supabase, nextRestaurantIds);
  if (restaurantCheck.error && nextRestaurantIds.length > 0) {
    return { error: restaurantCheck.error };
  }

  const { data: driver } = await supabase
    .from("drivers")
    .select("id, zone_id, status")
    .eq("id", driverId)
    .maybeSingle();
  if (!driver) return { error: "save_failed" };

  if (driver.status === "active" && nextRestaurantIds.length === 0) {
    return { error: "last_restaurant" };
  }

  const hasActive = await driverHasInTransitDelivery(supabase, driverId);

  await syncLinkedDriverRestaurants(supabase, driverId, nextRestaurantIds);

  await logAssignmentEvent(supabase, {
    driverId,
    changedBy: auth.session.id,
    changeType: "restaurant_remove",
    zoneIdBefore: driver.zone_id,
    zoneIdAfter: driver.zone_id,
    restaurantIdsBefore: beforeRestaurantIds,
    restaurantIdsAfter: nextRestaurantIds,
    contextEntityType: "restaurant",
    contextEntityId: restaurantId,
  });

  void logAdminMutation({
    action: "update",
    entityType: "driver",
    entityId: driverId,
    routeName: "unassignDriverFromRestaurant",
    after: { restaurant_id: restaurantId },
  });

  return {
    success: true,
    ...(hasActive ? { warning: "driver_has_active_delivery" as const } : {}),
  };
}
