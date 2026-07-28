import type { DeliveryListRow } from "./types";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type ResolvedRestaurant = {
  id: string;
  name: string;
};

type DeliveryRestaurantInput = {
  id: string;
  driver_id: string;
  partner_id: string | null;
  restaurant_id: string | null;
  restaurant_name: string | null;
};

type RestaurantRow = {
  id: string;
  name: string;
  partner_id: string | null;
  status: string | null;
  is_active: boolean | null;
};

function pickUniqueRestaurant(
  candidates: RestaurantRow[],
): ResolvedRestaurant | null {
  if (candidates.length !== 1) return null;
  const row = candidates[0]!;
  return { id: row.id, name: row.name };
}

function publishedRestaurants(candidates: RestaurantRow[]): RestaurantRow[] {
  return candidates.filter(
    (r) => r.is_active !== false && (r.status == null || r.status === "published"),
  );
}

/** Pick a best-effort restaurant for list display when several assignments exist. */
function pickDisplayRestaurant(
  candidates: RestaurantRow[],
  partnerId: string | null,
): ResolvedRestaurant | null {
  const published = publishedRestaurants(candidates);
  if (published.length === 0) return null;

  const pool = partnerId
    ? published.filter((r) => r.partner_id === partnerId)
    : published;
  if (pool.length === 0) return null;

  const row = [...pool].sort((a, b) => a.name.localeCompare(b.name))[0]!;
  return { id: row.id, name: row.name };
}

function resolveFromAssigned(
  assigned: RestaurantRow[],
  partnerId: string | null,
): ResolvedRestaurant | null {
  const unique = pickUniqueRestaurant(publishedRestaurants(assigned));
  if (unique) return unique;
  return pickDisplayRestaurant(assigned, partnerId);
}

function resolveFromPartnerRestaurants(
  partnerRestaurants: RestaurantRow[],
): ResolvedRestaurant | null {
  const unique = pickUniqueRestaurant(publishedRestaurants(partnerRestaurants));
  if (unique) return unique;
  return pickDisplayRestaurant(partnerRestaurants, null);
}

/**
 * Infer restaurant for deliveries where restaurant_id was never set (legacy
 * single-stage flow, or ambiguous multi-restaurant assignment at pickup).
 */
export async function batchResolveDeliveryRestaurants(
  supabase: Supabase,
  deliveries: DeliveryRestaurantInput[],
): Promise<Map<string, ResolvedRestaurant>> {
  const unresolved = deliveries.filter(
    (d) => !d.restaurant_name?.trim(),
  );
  const result = new Map<string, ResolvedRestaurant>();
  if (unresolved.length === 0) return result;

  const withRestaurantId = unresolved.filter(
    (d): d is DeliveryRestaurantInput & { restaurant_id: string } =>
      Boolean(d.restaurant_id),
  );
  if (withRestaurantId.length > 0) {
    const restaurantIds = [...new Set(withRestaurantId.map((d) => d.restaurant_id))];
    const { data: restaurantRows } = await supabase
      .from("restaurants")
      .select("id, name")
      .in("id", restaurantIds);
    const nameById = new Map(
      (restaurantRows ?? []).map((row) => [row.id, row.name] as const),
    );
    for (const delivery of withRestaurantId) {
      const name = nameById.get(delivery.restaurant_id);
      if (name) {
        result.set(delivery.id, { id: delivery.restaurant_id, name });
      }
    }
  }

  const needsInference = unresolved.filter((d) => !result.has(d.id) && !d.restaurant_id);
  if (needsInference.length === 0) return result;

  const driverIds = [...new Set(needsInference.map((d) => d.driver_id))];
  const partnerIds = [
    ...new Set(
      needsInference.map((d) => d.partner_id).filter((id): id is string => Boolean(id)),
    ),
  ];

  const [{ data: driverRestRows }, { data: partnerRestRows }] = await Promise.all([
    supabase
      .from("driver_restaurants")
      .select(
        "driver_id, restaurants (id, name, partner_id, status, is_active)",
      )
      .in("driver_id", driverIds),
    partnerIds.length > 0
      ? supabase
          .from("restaurants")
          .select("id, name, partner_id, status, is_active")
          .in("partner_id", partnerIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as RestaurantRow[] }),
  ]);

  const assignedByDriver = new Map<string, RestaurantRow[]>();
  for (const link of driverRestRows ?? []) {
    const rel = link.restaurants as
      | RestaurantRow
      | RestaurantRow[]
      | null
      | undefined;
    const row = Array.isArray(rel) ? rel[0] : rel;
    if (!row?.id) continue;
    const list = assignedByDriver.get(link.driver_id) ?? [];
    list.push(row);
    assignedByDriver.set(link.driver_id, list);
  }

  const partnerRestaurantsByPartner = new Map<string, RestaurantRow[]>();
  for (const row of (partnerRestRows ?? []) as RestaurantRow[]) {
    if (!row.partner_id) continue;
    const list = partnerRestaurantsByPartner.get(row.partner_id) ?? [];
    list.push(row);
    partnerRestaurantsByPartner.set(row.partner_id, list);
  }

  for (const delivery of needsInference) {
    const fromAssigned = resolveFromAssigned(
      assignedByDriver.get(delivery.driver_id) ?? [],
      delivery.partner_id,
    );
    if (fromAssigned) {
      result.set(delivery.id, fromAssigned);
      continue;
    }

    if (delivery.partner_id) {
      const fromPartner = resolveFromPartnerRestaurants(
        partnerRestaurantsByPartner.get(delivery.partner_id) ?? [],
      );
      if (fromPartner) {
        result.set(delivery.id, fromPartner);
      }
    }
  }

  return result;
}

export async function enrichDeliveryListRows(
  supabase: Supabase,
  rows: DeliveryListRow[],
): Promise<DeliveryListRow[]> {
  const resolved = await batchResolveDeliveryRestaurants(supabase, rows);
  if (resolved.size === 0) return rows;
  return rows.map((row) => {
    const inferred = resolved.get(row.id);
    if (!inferred) return row;
    return {
      ...row,
      restaurant_id: row.restaurant_id ?? inferred.id,
      restaurant_name: row.restaurant_name ?? inferred.name,
    };
  });
}
