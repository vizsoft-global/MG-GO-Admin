"use server";

import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import {
  canManageRestaurants,
  canViewRestaurants,
  hasPermissionInSet,
} from "@/lib/auth/permissions";
import {
  mapDeliveryDbRowsToListRows,
  type DeliveryDbRowForList,
} from "@/features/deliveries/map-delivery-list-row";
import type { DeliveryListRow, DeliveryStatus } from "@/features/deliveries/types";
import {
  applyRestaurantLogoFromForm,
  deleteRestaurantLogoFiles,
} from "./restaurant-logo-storage";
import {
  parseRestaurantFormData,
  validateRestaurantCoordinates,
} from "./parse-restaurant-form";
import {
  fromDbRestaurantStatus,
  toDbRestaurantStatus,
} from "./restaurant-status";
import { resolveRestaurantLogoUrls } from "@/lib/storage/restaurant-logo-url";
import {
  validateZoneGeometry,
  type ZoneGeoFeature,
  type ZoneGeometryType,
} from "@/lib/geo/zone-geometry";
import type { Json } from "@/types/database";
import type {
  RestaurantActivityEvent,
  RestaurantAssignedDriver,
  RestaurantDetailModel,
  RestaurantGeofence,
  RestaurantGeofenceInput,
  RestaurantGeofenceKind,
  RestaurantGeofenceMutationResult,
  RestaurantMutationResult,
  RestaurantPartnerOption,
  RestaurantRow,
  RestaurantZoneOption,
} from "./types";
import {
  buildActivityLogFromDeliveries,
  computeDeliveryStats,
  isDeliveryForRestaurant,
  type ScopedDeliveryRow,
} from "./restaurant-delivery-scope";

type PgLikeError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

function formatPgErrorDetail(
  error: PgLikeError | null | undefined,
): string | undefined {
  if (!error) return undefined;
  const parts: string[] = [];
  if (error.code) parts.push(`code ${error.code}`);
  if (error.message) parts.push(error.message);
  if (error.details) parts.push(error.details);
  if (error.hint) parts.push(`hint: ${error.hint}`);
  return parts.length > 0 ? parts.join(" — ") : undefined;
}

function logPgError(scope: string, error: PgLikeError | unknown): void {
  const e = error as PgLikeError;
  console.error(`[restaurants:${scope}]`, {
    code: e?.code ?? null,
    message: e?.message ?? null,
    details: e?.details ?? null,
    hint: e?.hint ?? null,
  });
}

function isMissingRelationError(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  const msg = error.message ?? "";
  return msg.includes("driver_intake_restaurants") || msg.includes("driver_restaurants");
}

async function requireDeliveriesView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "deliveries.view", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

const DELIVERY_LIST_SELECT =
  "id, driver_id, partner_id, restaurant_id, zone_id, external_order_id, order_proof_url, status, rejection_reason, delivered_at, delivered_lat, delivered_lng, pickup_at, pickup_lat, pickup_lng, pickup_proof_url, cancelled_at, cancel_lat, cancel_lng, cancel_reason, cancel_proof_url, created_at, drivers(driver_code, profiles(full_name, phone)), partners(name, logo_url), restaurants(id, name), zones(name)";

async function fetchAssignedDriverIdsForRestaurant(
  supabase: Awaited<ReturnType<typeof createClient>>,
  restaurantId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("driver_restaurants")
    .select("driver_id")
    .eq("restaurant_id", restaurantId);
  if (error && !isMissingRelationError(error)) {
    logPgError("assigned_drivers", error);
  }
  return new Set((data ?? []).map((row) => row.driver_id));
}

/** Linked driver assignments only — matches DriverAssignSheet / assign actions. */
async function fetchLinkedDriverCountsByRestaurant(
  supabase: Awaited<ReturnType<typeof createClient>>,
  restaurantIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const id of restaurantIds) counts.set(id, 0);
  if (restaurantIds.length === 0) return counts;

  const { data, error } = await supabase
    .from("driver_restaurants")
    .select("restaurant_id, driver_id")
    .in("restaurant_id", restaurantIds);
  if (error && !isMissingRelationError(error)) {
    logPgError("linked_driver_counts", error);
    return counts;
  }

  const uniqueByRestaurant = new Map<string, Set<string>>();
  for (const row of data ?? []) {
    const set = uniqueByRestaurant.get(row.restaurant_id) ?? new Set();
    set.add(row.driver_id);
    uniqueByRestaurant.set(row.restaurant_id, set);
  }
  for (const [restaurantId, set] of uniqueByRestaurant) {
    counts.set(restaurantId, set.size);
  }
  return counts;
}

async function fetchScopedDeliveryRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  restaurantId: string,
  restaurantPartnerId: string | null,
  assignedDriverIds: ReadonlySet<string>,
): Promise<ScopedDeliveryRow[]> {
  const [{ data: direct, error: directErr }, { data: indirect, error: indirectErr }] =
    await Promise.all([
      supabase
        .from("deliveries")
        .select(
          "id, driver_id, partner_id, restaurant_id, status, external_order_id, pickup_at, delivered_at, cancelled_at, cancel_reason, created_at, drivers(driver_code, profiles(full_name, phone))",
        )
        .eq("restaurant_id", restaurantId),
      assignedDriverIds.size > 0 && restaurantPartnerId
        ? supabase
            .from("deliveries")
            .select(
              "id, driver_id, partner_id, restaurant_id, status, external_order_id, pickup_at, delivered_at, cancelled_at, cancel_reason, created_at, drivers(driver_code, profiles(full_name, phone))",
            )
            .is("restaurant_id", null)
            .in("driver_id", [...assignedDriverIds])
            .eq("partner_id", restaurantPartnerId)
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (directErr) logPgError("scoped_deliveries_direct", directErr);
  if (indirectErr) logPgError("scoped_deliveries_indirect", indirectErr);

  type ScopedDeliveryDbRow = {
    id: string;
    driver_id: string;
    partner_id: string | null;
    restaurant_id: string | null;
    status: string;
    external_order_id: string | null;
    pickup_at: string | null;
    delivered_at: string | null;
    cancelled_at: string | null;
    cancel_reason: string | null;
    created_at: string;
    drivers:
      | {
          driver_code: string;
          profiles:
            | { full_name: string | null; phone: string | null }
            | { full_name: string | null; phone: string | null }[]
            | null;
        }
      | {
          driver_code: string;
          profiles:
            | { full_name: string | null; phone: string | null }
            | { full_name: string | null; phone: string | null }[]
            | null;
        }[]
      | null;
  };

  const merged = [
    ...((direct ?? []) as unknown as ScopedDeliveryDbRow[]),
    ...((indirect ?? []) as unknown as ScopedDeliveryDbRow[]),
  ];

  const byId = new Map<string, ScopedDeliveryRow>();
  for (const row of merged) {
    if (byId.has(row.id)) continue;
    const driverRel = Array.isArray(row.drivers) ? row.drivers[0] : row.drivers;
    const profileRel = driverRel?.profiles;
    const profile = Array.isArray(profileRel) ? profileRel[0] : profileRel;
    byId.set(row.id, {
      id: row.id,
      driver_id: row.driver_id,
      partner_id: row.partner_id,
      restaurant_id: row.restaurant_id,
      status: row.status as DeliveryStatus,
      external_order_id: row.external_order_id,
      pickup_at: row.pickup_at,
      delivered_at: row.delivered_at,
      cancelled_at: row.cancelled_at,
      cancel_reason: row.cancel_reason,
      created_at: row.created_at,
      driver_name: profile?.full_name ?? undefined,
      driver_code: driverRel?.driver_code ?? undefined,
    });
  }

  return [...byId.values()].filter((d) =>
    isDeliveryForRestaurant(d, restaurantId, restaurantPartnerId, assignedDriverIds),
  );
}

async function fetchRestaurantListAggregates(
  supabase: Awaited<ReturnType<typeof createClient>>,
  restaurantIds: string[],
  restaurants: Array<{
    id: string;
    partner_id: string | null;
    latitude: number | null;
    longitude: number | null;
  }>,
): Promise<
  Map<
    string,
    Pick<
      RestaurantRow,
      | "active_deliveries"
      | "deliveries_total"
      | "deliveries_verified"
      | "deliveries_cancelled"
      | "has_coordinates"
      | "geofence_count"
    >
  >
> {
  const result = new Map<
    string,
    Pick<
      RestaurantRow,
      | "active_deliveries"
      | "deliveries_total"
      | "deliveries_verified"
      | "deliveries_cancelled"
      | "has_coordinates"
      | "geofence_count"
    >
  >();

  for (const r of restaurants) {
    result.set(r.id, {
      active_deliveries: 0,
      deliveries_total: 0,
      deliveries_verified: 0,
      deliveries_cancelled: 0,
      has_coordinates: hasValidCoordinates(
        r.latitude != null ? Number(r.latitude) : null,
        r.longitude != null ? Number(r.longitude) : null,
      ),
      geofence_count: 0,
    });
  }

  if (restaurantIds.length === 0) return result;

  const partnerByRestaurant = new Map(
    restaurants.map((r) => [r.id, r.partner_id]),
  );

  const [{ data: geofences, error: geofenceErr }, { data: driverLinks, error: driverErr }, { data: deliveries, error: deliveryErr }] =
    await Promise.all([
      supabase
        .from("restaurant_geofences")
        .select("restaurant_id")
        .in("restaurant_id", restaurantIds),
      supabase
        .from("driver_restaurants")
        .select("restaurant_id, driver_id")
        .in("restaurant_id", restaurantIds),
      supabase
        .from("deliveries")
        .select("id, restaurant_id, driver_id, partner_id, status"),
    ]);

  if (geofenceErr) logPgError("list_geofence_counts", geofenceErr);
  if (driverErr && !isMissingRelationError(driverErr)) {
    logPgError("list_driver_links", driverErr);
  }
  if (deliveryErr) logPgError("list_delivery_stats", deliveryErr);

  const geofenceCounts = new Map<string, number>();
  for (const row of geofences ?? []) {
    geofenceCounts.set(row.restaurant_id, (geofenceCounts.get(row.restaurant_id) ?? 0) + 1);
  }

  const driversByRestaurant = new Map<string, Set<string>>();
  for (const row of driverLinks ?? []) {
    const set = driversByRestaurant.get(row.restaurant_id) ?? new Set();
    set.add(row.driver_id);
    driversByRestaurant.set(row.restaurant_id, set);
  }

  const statsByRestaurant = new Map<string, ScopedDeliveryRow[]>();
  for (const restaurantId of restaurantIds) {
    statsByRestaurant.set(restaurantId, []);
  }

  for (const d of deliveries ?? []) {
    const status = d.status as DeliveryStatus;
    const scoped: ScopedDeliveryRow = {
      id: d.id,
      driver_id: d.driver_id,
      partner_id: d.partner_id,
      restaurant_id: d.restaurant_id,
      status,
      external_order_id: null,
      pickup_at: null,
      delivered_at: null,
      cancelled_at: null,
      cancel_reason: null,
      created_at: "",
    };

    if (d.restaurant_id && statsByRestaurant.has(d.restaurant_id)) {
      statsByRestaurant.get(d.restaurant_id)!.push(scoped);
      continue;
    }

    if (d.restaurant_id != null) continue;

    for (const restaurantId of restaurantIds) {
      const partnerId = partnerByRestaurant.get(restaurantId) ?? null;
      const assigned = driversByRestaurant.get(restaurantId) ?? new Set();
      if (isDeliveryForRestaurant(scoped, restaurantId, partnerId, assigned)) {
        statsByRestaurant.get(restaurantId)!.push(scoped);
      }
    }
  }

  for (const restaurantId of restaurantIds) {
    const base = result.get(restaurantId)!;
    const stats = computeDeliveryStats(statsByRestaurant.get(restaurantId) ?? []);
    result.set(restaurantId, {
      ...base,
      active_deliveries: stats.active_deliveries,
      deliveries_total: stats.deliveries_total,
      deliveries_verified: stats.deliveries_verified,
      deliveries_cancelled: stats.deliveries_cancelled,
      geofence_count: geofenceCounts.get(restaurantId) ?? 0,
    });
  }

  return result;
}

async function mapRestaurantBaseRow(
  row: {
    id: string;
    partner_id: string | null;
    zone_id: string | null;
    name: string;
    logo_url: string | null;
    external_merchant_id: string | null;
    map_link: string | null;
    latitude: number | null;
    longitude: number | null;
    status: string;
    is_active: boolean;
    created_at: string;
  },
  partnerMap: Map<string, string>,
  zoneMap: Map<string, string>,
  driverCount: number,
  aggregates: Pick<
    RestaurantRow,
    | "active_deliveries"
    | "deliveries_total"
    | "deliveries_verified"
    | "deliveries_cancelled"
    | "has_coordinates"
    | "geofence_count"
  >,
): Promise<RestaurantRow> {
  return {
    id: row.id,
    partner_id: row.partner_id,
    partner_name: row.partner_id ? (partnerMap.get(row.partner_id) ?? "—") : "—",
    zone_id: row.zone_id,
    zone_name: row.zone_id ? (zoneMap.get(row.zone_id) ?? "—") : "—",
    name: row.name,
    logo_url: row.logo_url,
    logo_display_url: null,
    external_merchant_id: row.external_merchant_id,
    map_link: row.map_link,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    status: fromDbRestaurantStatus(row.status, row.is_active),
    is_active: row.is_active,
    driver_count: driverCount,
    created_at: row.created_at,
    ...aggregates,
  };
}

async function requireRestaurantsView() {
  const session = await getSessionUser();
  if (!session || !canViewRestaurants(session.permissions, session.isSuperAdmin)) {
    throw new Error("not_authorized");
  }
  return session;
}

async function requireRestaurantsManage() {
  const session = await getSessionUser();
  if (!session || !canManageRestaurants(session.permissions, session.isSuperAdmin)) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

export async function fetchRestaurantPartnerOptions(): Promise<RestaurantPartnerOption[]> {
  await requireRestaurantsView();
  const supabase = await createClient();
  const { data, error } = await supabase.from("partners").select("id, name").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function fetchRestaurantZoneOptions(): Promise<RestaurantZoneOption[]> {
  await requireRestaurantsView();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("zones")
    .select("id, name, code")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function fetchRestaurantsForAdmin(): Promise<RestaurantRow[]> {
  await requireRestaurantsView();
  void logAdminRead("restaurants", "fetchRestaurantsForAdmin");
  const supabase = await createClient();

  const [
    { data: restaurants, error: restaurantsError },
    { data: partners, error: partnersError },
    { data: zones, error: zonesError },
  ] = await Promise.all([
    supabase
      .from("restaurants")
      .select(
        "id, partner_id, zone_id, name, logo_url, external_merchant_id, map_link, latitude, longitude, status, is_active, created_at",
      )
      .order("name"),
    supabase.from("partners").select("id, name"),
    supabase.from("zones").select("id, name, code"),
  ]);

  if (restaurantsError) {
    logPgError("list", restaurantsError);
    throw restaurantsError;
  }
  if (partnersError) logPgError("list_partners", partnersError);
  if (zonesError) logPgError("list_zones", zonesError);

  const partnerMap = new Map((partners ?? []).map((p) => [p.id, p.name]));
  const zoneMap = new Map(
    (zones ?? []).map((z) => [z.id, `${z.name} (${z.code})`]),
  );
  const ids = (restaurants ?? []).map((r) => r.id);

  const driverCounts =
    ids.length > 0
      ? await fetchLinkedDriverCountsByRestaurant(supabase, ids)
      : new Map<string, number>();

  const listAggregates = await fetchRestaurantListAggregates(
    supabase,
    ids,
    (restaurants ?? []).map((r) => ({
      id: r.id,
      partner_id: r.partner_id,
      latitude: r.latitude != null ? Number(r.latitude) : null,
      longitude: r.longitude != null ? Number(r.longitude) : null,
    })),
  );

  const rows = await Promise.all(
    (restaurants ?? []).map(async (row) => {
      const aggregates =
        listAggregates.get(row.id) ?? {
          active_deliveries: 0,
          deliveries_total: 0,
          deliveries_verified: 0,
          deliveries_cancelled: 0,
          has_coordinates: hasValidCoordinates(
            row.latitude != null ? Number(row.latitude) : null,
            row.longitude != null ? Number(row.longitude) : null,
          ),
          geofence_count: 0,
        };
      return mapRestaurantBaseRow(
        row,
        partnerMap,
        zoneMap,
        driverCounts.get(row.id) ?? 0,
        aggregates,
      );
    }),
  );

  try {
    return await resolveRestaurantLogoUrls(rows);
  } catch (error) {
    logPgError("logo_urls", error);
    return rows.map((row) => ({ ...row, logo_display_url: null }));
  }
}

export async function fetchRestaurantPickerOptions(): Promise<
  Array<{
    id: string;
    name: string;
    partner_id: string | null;
    partner_name: string | null;
    status: RestaurantRow["status"];
  }>
> {
  await requireRestaurantsView();
  const supabase = await createClient();
  const [{ data: restaurants, error }, { data: partners, error: partnersError }] =
    await Promise.all([
      supabase
        .from("restaurants")
        .select("id, name, partner_id, status")
        .order("name"),
      supabase.from("partners").select("id, name"),
    ]);

  if (error) {
    logPgError("picker", error);
    throw error;
  }
  if (partnersError) logPgError("picker_partners", partnersError);

  const partnerNameById = new Map((partners ?? []).map((p) => [p.id, p.name]));

  return (restaurants ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    partner_id: row.partner_id,
    partner_name: row.partner_id
      ? (partnerNameById.get(row.partner_id) ?? null)
      : null,
    status: fromDbRestaurantStatus(row.status),
  }));
}

function validateGeofenceInput(
  input: RestaurantGeofenceInput,
): string | null {
  if (input.kind !== "inclusion" && input.kind !== "exclusion") {
    return "invalid_kind";
  }
  return validateZoneGeometry(input.zone_type, input.geometry);
}

function mapGeofenceRow(row: {
  id: string;
  restaurant_id: string;
  kind: string;
  zone_type: string;
  geometry: Json;
  name: string | null;
  color: string;
  created_at: string;
}): RestaurantGeofence {
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    kind: row.kind as RestaurantGeofenceKind,
    zone_type: row.zone_type as ZoneGeometryType,
    geometry: row.geometry as unknown as ZoneGeoFeature,
    name: row.name,
    color: row.color,
    created_at: row.created_at,
  };
}

export async function fetchRestaurantGeofences(
  restaurantId: string,
): Promise<RestaurantGeofence[]> {
  await requireRestaurantsView();
  if (!restaurantId) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("restaurant_geofences")
    .select(
      "id, restaurant_id, kind, zone_type, geometry, name, color, created_at",
    )
    .eq("restaurant_id", restaurantId)
    .order("created_at");

  if (error) throw error;
  return (data ?? []).map(mapGeofenceRow);
}

export async function fetchRestaurantDetail(
  restaurantId: string,
): Promise<RestaurantDetailModel | null> {
  await requireRestaurantsView();
  if (!restaurantId) return null;
  void logAdminRead("restaurants", "fetchRestaurantDetail", { restaurantId });

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("restaurants")
    .select(
      "id, partner_id, zone_id, name, logo_url, external_merchant_id, map_link, latitude, longitude, status, is_active, created_at",
    )
    .eq("id", restaurantId)
    .maybeSingle();

  if (error) {
    logPgError("detail", error);
    throw error;
  }
  if (!row) return null;

  const [{ data: partners }, { data: zones }] = await Promise.all([
    row.partner_id
      ? supabase.from("partners").select("id, name").eq("id", row.partner_id)
      : Promise.resolve({ data: [] }),
    row.zone_id
      ? supabase.from("zones").select("id, name, code").eq("id", row.zone_id)
      : Promise.resolve({ data: [] }),
  ]);

  const partnerMap = new Map((partners ?? []).map((p) => [p.id, p.name]));
  const zoneMap = new Map(
    (zones ?? []).map((z) => [z.id, `${z.name} (${z.code})`]),
  );

  const driverCount = (
    await fetchLinkedDriverCountsByRestaurant(supabase, [restaurantId])
  ).get(restaurantId) ?? 0;

  const aggregates = (
    await fetchRestaurantListAggregates(supabase, [restaurantId], [
      {
        id: restaurantId,
        partner_id: row.partner_id,
        latitude: row.latitude != null ? Number(row.latitude) : null,
        longitude: row.longitude != null ? Number(row.longitude) : null,
      },
    ])
  ).get(restaurantId)!;

  const assignedDriverIds = await fetchAssignedDriverIdsForRestaurant(
    supabase,
    restaurantId,
  );
  const scopedDeliveries = await fetchScopedDeliveryRows(
    supabase,
    restaurantId,
    row.partner_id,
    assignedDriverIds,
  );
  const deliveryStats = computeDeliveryStats(scopedDeliveries);

  const base = await mapRestaurantBaseRow(
    row,
    partnerMap,
    zoneMap,
    driverCount,
    aggregates,
  );

  const [withLogo] = await resolveRestaurantLogoUrls([base]);

  return {
    ...withLogo,
    geofence_count: aggregates.geofence_count,
    has_coordinates: aggregates.has_coordinates,
    delivery_stats: deliveryStats,
  };
}

export async function fetchRestaurantAssignedDrivers(
  restaurantId: string,
): Promise<RestaurantAssignedDriver[]> {
  await requireRestaurantsView();
  if (!restaurantId) return [];

  const supabase = await createClient();
  const [{ data: linkedRows, error: linkedErr }, { data: intakeRows, error: intakeErr }] =
    await Promise.all([
      supabase
        .from("driver_restaurants")
        .select(
          "driver_id, drivers(id, driver_code, is_on_duty, is_blocked, profiles(full_name, phone))",
        )
        .eq("restaurant_id", restaurantId),
      supabase
        .from("driver_intake_restaurants")
        .select(
          "intake_id, driver_intakes(id, full_name, phone, driver_code, linked, linked_profile_id)",
        )
        .eq("restaurant_id", restaurantId),
    ]);

  if (linkedErr && !isMissingRelationError(linkedErr)) {
    logPgError("assigned_linked", linkedErr);
  }
  if (intakeErr && !isMissingRelationError(intakeErr)) {
    logPgError("assigned_intake", intakeErr);
  }

  const results: RestaurantAssignedDriver[] = [];
  const linkedDriverIds = (linkedRows ?? []).map((row) => row.driver_id);

  const { data: intakeByProfile } =
    linkedDriverIds.length > 0
      ? await supabase
          .from("driver_intakes")
          .select("id, linked_profile_id")
          .in("linked_profile_id", linkedDriverIds)
          .is("archived_at", null)
      : { data: [] as { id: string; linked_profile_id: string | null }[] };

  const intakeIdByDriverId = new Map(
    (intakeByProfile ?? [])
      .filter((row) => row.linked_profile_id)
      .map((row) => [row.linked_profile_id as string, row.id]),
  );

  for (const row of linkedRows ?? []) {
    const driverRel = Array.isArray(row.drivers) ? row.drivers[0] : row.drivers;
    if (!driverRel) continue;
    const profileRel = driverRel.profiles;
    const profile = Array.isArray(profileRel) ? profileRel[0] : profileRel;
    results.push({
      id: `linked:${row.driver_id}`,
      driver_id: row.driver_id,
      intake_id: intakeIdByDriverId.get(row.driver_id) ?? null,
      name: profile?.full_name ?? "—",
      driver_code: driverRel.driver_code ?? "—",
      phone: profile?.phone ?? null,
      link_status: "linked",
      is_on_duty: driverRel.is_on_duty ?? false,
      is_blocked: driverRel.is_blocked ?? false,
    });
  }

  for (const row of intakeRows ?? []) {
    const intake = Array.isArray(row.driver_intakes)
      ? row.driver_intakes[0]
      : row.driver_intakes;
    if (!intake || intake.linked) continue;
    results.push({
      id: `intake:${row.intake_id}`,
      driver_id: null,
      intake_id: row.intake_id,
      name: intake.full_name ?? "—",
      driver_code: intake.driver_code ?? "—",
      phone: intake.phone ?? null,
      link_status: "intake",
      is_on_duty: false,
      is_blocked: false,
    });
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export type RestaurantDeliveriesFilter = {
  status?: DeliveryStatus | "all" | "active";
};

export async function fetchRestaurantDeliveries(
  restaurantId: string,
  opts: RestaurantDeliveriesFilter = {},
): Promise<DeliveryListRow[]> {
  await requireDeliveriesView();
  if (!restaurantId) return [];
  void logAdminRead("restaurants", "fetchRestaurantDeliveries", { restaurantId });

  const supabase = await createClient();
  const { data: restaurant, error: restaurantErr } = await supabase
    .from("restaurants")
    .select("partner_id")
    .eq("id", restaurantId)
    .maybeSingle();
  if (restaurantErr) throw restaurantErr;
  if (!restaurant) return [];

  const assignedDriverIds = await fetchAssignedDriverIdsForRestaurant(
    supabase,
    restaurantId,
  );

  const [{ data: direct, error: directErr }, { data: indirect, error: indirectErr }] =
    await Promise.all([
      supabase.from("deliveries").select(DELIVERY_LIST_SELECT).eq("restaurant_id", restaurantId),
      assignedDriverIds.size > 0 && restaurant.partner_id
        ? supabase
            .from("deliveries")
            .select(DELIVERY_LIST_SELECT)
            .is("restaurant_id", null)
            .in("driver_id", [...assignedDriverIds])
            .eq("partner_id", restaurant.partner_id)
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (directErr) throw directErr;
  if (indirectErr) throw indirectErr;

  const byId = new Map<string, DeliveryDbRowForList>();
  for (const row of [
    ...((direct ?? []) as unknown as DeliveryDbRowForList[]),
    ...((indirect ?? []) as unknown as DeliveryDbRowForList[]),
  ]) {
    if (!byId.has(row.id)) {
      byId.set(row.id, row);
    }
  }

  let rows = [...byId.values()].filter((d) =>
    isDeliveryForRestaurant(
      {
        driver_id: d.driver_id,
        partner_id: d.partner_id,
        restaurant_id: d.restaurant_id ?? null,
      },
      restaurantId,
      restaurant.partner_id,
      assignedDriverIds,
    ),
  );

  if (opts.status && opts.status !== "all") {
    if (opts.status === "active") {
      rows = rows.filter((r) => r.status === "in_transit");
    } else {
      rows = rows.filter((r) => r.status === opts.status);
    }
  }

  rows.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return mapDeliveryDbRowsToListRows(rows);
}

export async function fetchRestaurantActivityLog(
  restaurantId: string,
  limit = 100,
): Promise<RestaurantActivityEvent[]> {
  await requireDeliveriesView();
  if (!restaurantId) return [];

  const supabase = await createClient();
  const { data: restaurant, error: restaurantErr } = await supabase
    .from("restaurants")
    .select("partner_id")
    .eq("id", restaurantId)
    .maybeSingle();
  if (restaurantErr) throw restaurantErr;
  if (!restaurant) return [];

  const assignedDriverIds = await fetchAssignedDriverIdsForRestaurant(
    supabase,
    restaurantId,
  );
  const scoped = await fetchScopedDeliveryRows(
    supabase,
    restaurantId,
    restaurant.partner_id,
    assignedDriverIds,
  );

  return buildActivityLogFromDeliveries(scoped, limit);
}

export async function saveRestaurantGeofences(
  restaurantId: string,
  geofences: RestaurantGeofenceInput[],
): Promise<RestaurantGeofenceMutationResult> {
  const auth = await requireRestaurantsManage();
  if (auth.error) return { error: auth.error };
  if (!restaurantId) return { error: "missing_fields" };

  for (const geofence of geofences) {
    const validationError = validateGeofenceInput(geofence);
    if (validationError) return { error: validationError };
  }

  const supabase = await createClient();
  const { data: existing, error: fetchError } = await supabase
    .from("restaurant_geofences")
    .select("id")
    .eq("restaurant_id", restaurantId);

  if (fetchError) return { error: "save_failed" };

  const incomingIds = new Set(
    geofences.map((g) => g.id).filter((id): id is string => Boolean(id)),
  );
  const toDelete = (existing ?? [])
    .map((row) => row.id)
    .filter((id) => !incomingIds.has(id));

  if (toDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from("restaurant_geofences")
      .delete()
      .in("id", toDelete);
    if (deleteError) return { error: "save_failed" };
  }

  for (const geofence of geofences) {
    const payload = {
      restaurant_id: restaurantId,
      kind: geofence.kind,
      zone_type: geofence.zone_type,
      geometry: geofence.geometry as unknown as Json,
      name: geofence.name?.trim() || null,
      color: geofence.color ?? (geofence.kind === "inclusion" ? "#22c55e" : "#ef4444"),
      updated_at: new Date().toISOString(),
    };

    if (geofence.id) {
      const { error } = await supabase
        .from("restaurant_geofences")
        .update(payload)
        .eq("id", geofence.id)
        .eq("restaurant_id", restaurantId);
      if (error) return { error: "save_failed" };
    } else {
      const { error } = await supabase.from("restaurant_geofences").insert({
        ...payload,
        created_by: auth.session.id,
      });
      if (error) return { error: "save_failed" };
    }
  }

  void logAdminMutation({
    action: "update",
    entityType: "restaurant",
    entityId: restaurantId,
    routeName: "saveRestaurantGeofences",
    after: { geofence_count: geofences.length },
  });

  return { success: true };
}

function hasValidCoordinates(
  latitude: number | null,
  longitude: number | null,
): boolean {
  return (
    latitude != null &&
    longitude != null &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude)
  );
}

async function countInclusionGeofences(
  supabase: Awaited<ReturnType<typeof createClient>>,
  restaurantId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("restaurant_geofences")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId)
    .eq("kind", "inclusion");
  if (error) {
    logPgError("count_inclusion_geofences", error);
    return 0;
  }
  return count ?? 0;
}

export async function saveRestaurant(formData: FormData): Promise<RestaurantMutationResult> {
  const auth = await requireRestaurantsManage();
  if (auth.error) return { error: auth.error };

  const parsed = parseRestaurantFormData(formData);
  const {
    id,
    partnerId,
    zoneId,
    name,
    externalMerchantId,
    mapLink,
    status: requestedStatus,
    latitude,
    longitude,
    inclusionGeofenceCount,
  } = parsed;

  if (!name) return { error: "missing_fields" };

  const coordError = validateRestaurantCoordinates(latitude, longitude);
  if (coordError) return { error: coordError };

  const supabase = await createClient();

  let status = requestedStatus;
  let statusWarning: RestaurantMutationResult["statusWarning"];

  if (status === "published") {
    let hasInclusionGeofence = inclusionGeofenceCount > 0;
    if (!hasInclusionGeofence && id) {
      hasInclusionGeofence = (await countInclusionGeofences(supabase, id)) > 0;
    }
    const hasCoords = hasValidCoordinates(latitude, longitude);
    if (!hasCoords && !hasInclusionGeofence) {
      status = "draft";
      statusWarning = "auto_downgraded_to_draft";
    }
  }

  const isActive = status === "published";

  const payload = {
    partner_id: partnerId || null,
    zone_id: zoneId || null,
    name,
    external_merchant_id: externalMerchantId || null,
    map_link: mapLink || null,
    latitude,
    longitude,
    status: toDbRestaurantStatus(status),
    is_active: isActive && status !== "archived",
    updated_at: new Date().toISOString(),
  };

  if (id) {
    const logoResult = await applyRestaurantLogoFromForm(id, formData, auth.session.id);
    const patch = {
      ...payload,
      ...(logoResult.logoUrl !== undefined ? { logo_url: logoResult.logoUrl } : {}),
    };
    const { error } = await supabase.from("restaurants").update(patch).eq("id", id);
    if (error) {
      if (error.code === "23505") return { error: "restaurant_exists" };
      logPgError("update", error);
      return { error: "save_failed", errorDetail: formatPgErrorDetail(error) };
    }
    void logAdminMutation({
      action: "update",
      entityType: "restaurant",
      entityId: id,
      routeName: "saveRestaurant",
      after: { name, partner_id: partnerId, zone_id: zoneId, status },
    });
    return {
      success: true,
      id,
      logoUrl: logoResult.logoUrl,
      logoWarning: logoResult.logoWarning,
      statusWarning,
      finalStatus: status,
    };
  }

  const insertPayload = {
    ...payload,
    created_by: auth.session.id,
  };

  const { data, error } = await supabase
    .from("restaurants")
    .insert(insertPayload)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { error: "restaurant_exists" };
    logPgError("insert", error);
    return { error: "save_failed", errorDetail: formatPgErrorDetail(error) };
  }

  const logoResult = await applyRestaurantLogoFromForm(
    data.id,
    formData,
    auth.session.id,
  );
  if (logoResult.logoUrl !== undefined) {
    await supabase
      .from("restaurants")
      .update({
        logo_url: logoResult.logoUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);
  }

  void logAdminMutation({
    action: "create",
    entityType: "restaurant",
    entityId: data.id,
    routeName: "saveRestaurant",
    after: { name, partner_id: partnerId, zone_id: zoneId, status },
  });

  return {
    success: true,
    id: data.id,
    logoUrl: logoResult.logoUrl,
    logoWarning: logoResult.logoWarning,
    statusWarning,
    finalStatus: status,
  };
}

export async function deleteRestaurant(id: string): Promise<RestaurantMutationResult> {
  const auth = await requireRestaurantsManage();
  if (auth.error) return { error: auth.error };
  if (!id) return { error: "missing_fields" };

  const supabase = await createClient();
  await deleteRestaurantLogoFiles(id);
  const { error } = await supabase.from("restaurants").delete().eq("id", id);
  if (error) return { error: "delete_failed" };
  void logAdminMutation({
    action: "delete",
    entityType: "restaurant",
    entityId: id,
    routeName: "deleteRestaurant",
  });
  return { success: true };
}
