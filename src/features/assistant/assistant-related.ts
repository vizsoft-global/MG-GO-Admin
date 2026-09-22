import { countDeliveriesByFilters, fetchRecentDeliveriesForDriver } from "@/features/deliveries/deliveries-actions";
import { getDriverGroup } from "@/features/driver-groups/driver-groups-actions";
import { fetchDriverDetail } from "@/features/drivers/drivers-actions";
import { fetchAdminRequestsList } from "@/features/requests/requests-actions";
import { fetchRestaurantAssignedDrivers } from "@/features/restaurants/restaurants-actions";
import { logAdminRead } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import { assistantModuleAllowed, requireAssistantModule } from "./assistant-gates";
import { ASSISTANT_LIST_CAP, ENTITY_MODULE_PERMISSION, type AssistantEntityType } from "./assistant-entity";
import { sectionDenied } from "./assistant-strip";
import { stripDeliveryHead, stripRequestRow, stripVehicleRow } from "./assistant-strip";

export const RELATED_RELATIONS = [
  "complaints",
  "requests",
  "restaurants",
  "drivers",
  "vehicles",
  "deliveries",
  "members",
  "assigned_drivers",
  "pending_requests",
] as const;

export type RelatedRelation = (typeof RELATED_RELATIONS)[number];

export function capLimit(limit?: number): number {
  const n = limit ?? 10;
  return Math.max(1, Math.min(ASSISTANT_LIST_CAP, n));
}

export function relatedPayload(count: number, head: unknown[]) {
  return { count, head };
}

async function restaurantsInZone(zoneId: string, limit: number) {
  const supabase = await createClient();
  const countRes = await supabase
    .from("restaurants")
    .select("id", { count: "exact", head: true })
    .eq("zone_id", zoneId);
  const { data } = await supabase
    .from("restaurants")
    .select("id, name, status")
    .eq("zone_id", zoneId)
    .order("name")
    .limit(limit);
  return relatedPayload(countRes.count ?? 0, data ?? []);
}

async function driversInZone(zoneId: string, limit: number) {
  const supabase = await createClient();
  const countRes = await supabase
    .from("drivers")
    .select("id", { count: "exact", head: true })
    .eq("zone_id", zoneId)
    .is("archived_at", null);
  const { data } = await supabase
    .from("drivers")
    .select("id, driver_code, profiles!drivers_id_fkey(full_name)")
    .eq("zone_id", zoneId)
    .is("archived_at", null)
    .limit(limit);
  return relatedPayload(
    countRes.count ?? 0,
    (data ?? []).map((row) => {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      return { id: row.id, driver_code: row.driver_code, name: (profile as { full_name?: string } | null)?.full_name ?? null };
    }),
  );
}

async function fleetDrivers(limit: number) {
  const supabase = await createClient();
  const countRes = await supabase
    .from("drivers")
    .select("id", { count: "exact", head: true })
    .eq("is_on_duty", true)
    .not("vehicle_id", "is", null)
    .is("archived_at", null);
  const { data } = await supabase
    .from("drivers")
    .select("id, driver_code, vehicle_id, profiles!drivers_id_fkey(full_name)")
    .eq("is_on_duty", true)
    .not("vehicle_id", "is", null)
    .is("archived_at", null)
    .limit(limit);
  return relatedPayload(
    countRes.count ?? 0,
    (data ?? []).map((row) => {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      return {
        id: row.id,
        driver_code: row.driver_code,
        vehicle_id: row.vehicle_id,
        name: (profile as { full_name?: string } | null)?.full_name ?? null,
      };
    }),
  );
}

async function vehicleForDriver(driverId: string) {
  const supabase = await createClient();
  const { data: driver } = await supabase
    .from("drivers")
    .select("vehicle_id, driver_code")
    .eq("id", driverId)
    .maybeSingle();
  if (!driver?.vehicle_id) return relatedPayload(0, []);
  const { data: vehicle } = await supabase
    .from("vehicles")
    .select("id, bike_id, reg_number, status, vehicle_type_key, condition")
    .eq("id", driver.vehicle_id)
    .maybeSingle();
  return relatedPayload(vehicle ? 1 : 0, vehicle ? [stripVehicleRow(vehicle)] : []);
}

export async function listRelated(input: {
  from_type: AssistantEntityType;
  id: string;
  relation: RelatedRelation;
  status?: string;
  limit?: number;
}) {
  const session = await requireAssistantModule(ENTITY_MODULE_PERMISSION[input.from_type]);
  const limit = capLimit(input.limit);
  void logAdminRead("assistant", "assistant.tool", {
    tool: "list_related",
    entity_type: input.from_type,
    id: input.id,
    relation: input.relation,
  });

  const can = (slug: Parameters<typeof assistantModuleAllowed>[2]) =>
    assistantModuleAllowed(session.permissions, session.isSuperAdmin, slug);

  if (input.relation === "complaints" || input.relation === "requests" || input.relation === "pending_requests") {
    if (!can("requests.view")) return { relation: input.relation, ...sectionDenied("/requests") };
    let search: string | undefined;
    let zoneId: string | undefined;
    if (input.from_type === "driver") {
      const detail = can("drivers.view") ? await fetchDriverDetail(input.id) : null;
      search = detail?.driver_code || input.id;
    } else if (input.from_type === "zone") {
      zoneId = input.id;
    }
    const type = input.relation === "complaints" ? "complaint" : undefined;
    const status =
      input.relation === "pending_requests" ? input.status || "in_review" : input.status;
    const list = await fetchAdminRequestsList({
      datePreset: "all",
      search,
      zoneId,
      type,
      status,
      limit,
      offset: 0,
    });
    return {
      relation: input.relation,
      count: list.filteredTotal,
      kpi: list.kpi,
      head: list.rows.map((row) => stripRequestRow(row as unknown as Record<string, unknown>)),
      focus: { entity_type: input.from_type, id: input.id },
    };
  }

  if (input.relation === "restaurants") {
    if (!can("restaurants.view")) return { relation: input.relation, ...sectionDenied("/restaurants") };
    if (input.from_type === "zone") {
      const payload = await restaurantsInZone(input.id, limit);
      return { relation: input.relation, ...payload, focus: { entity_type: "zone" as const, id: input.id, zone_id: input.id } };
    }
    if (input.from_type === "driver") {
      const detail = await fetchDriverDetail(input.id);
      const names = detail?.restaurant_names ?? [];
      const ids = detail?.restaurant_ids ?? [];
      return {
        relation: input.relation,
        count: names.length,
        head: names.slice(0, limit).map((name, i) => ({ id: ids[i] ?? null, name })),
        focus: { entity_type: "driver" as const, id: input.id, driver_id: input.id, zone_id: detail?.zone_id || undefined },
      };
    }
    return { relation: input.relation, ...sectionDenied("/restaurants") };
  }

  if (input.relation === "drivers" || input.relation === "members" || input.relation === "assigned_drivers") {
    if (input.from_type === "zone") {
      if (!can("drivers.view")) return { relation: input.relation, ...sectionDenied("/drivers") };
      return { relation: input.relation, ...(await driversInZone(input.id, limit)), focus: { entity_type: "zone", id: input.id, zone_id: input.id } };
    }
    if (input.from_type === "fleet") {
      if (!can("drivers.view")) return { relation: input.relation, ...sectionDenied("/drivers") };
      return { relation: input.relation, ...(await fleetDrivers(limit)), focus: { entity_type: "fleet", id: input.id } };
    }
    if (input.from_type === "driver_group") {
      if (!can("driver_groups.view")) return { relation: input.relation, ...sectionDenied("/drivers") };
      const group = await getDriverGroup(input.id);
      const members = (group?.members ?? []).slice(0, limit).map((m) => ({
        id: m.id,
        driver_code: m.driver_code,
        name: m.full_name,
      }));
      return { relation: input.relation, count: group?.members.length ?? 0, head: members, focus: { entity_type: "driver_group", id: input.id } };
    }
    if (input.from_type === "restaurant") {
      if (!can("restaurants.view")) return { relation: input.relation, ...sectionDenied("/restaurants") };
      const assigned = await fetchRestaurantAssignedDrivers(input.id);
      return {
        relation: input.relation,
        count: assigned.length,
        head: assigned.slice(0, limit).map((row) => ({
          driver_id: row.driver_id,
          name: row.name,
          driver_code: row.driver_code,
          is_on_duty: row.is_on_duty,
        })),
        focus: { entity_type: "restaurant", id: input.id },
      };
    }
    return { relation: input.relation, error: "unavailable", reason: "unsupported_relation" };
  }

  if (input.relation === "vehicles") {
    if (!can("vehicles.view") && !can("drivers.view")) return { relation: input.relation, ...sectionDenied("/vehicles") };
    if (input.from_type === "driver") {
      return { relation: input.relation, ...(await vehicleForDriver(input.id)), focus: { entity_type: "driver", id: input.id, driver_id: input.id } };
    }
    return { relation: input.relation, error: "unavailable", reason: "unsupported_relation" };
  }

  if (input.relation === "deliveries") {
    if (!can("deliveries.view")) return { relation: input.relation, ...sectionDenied("/deliveries") };
    if (input.from_type === "driver") {
      const [counts, head] = await Promise.all([
        countDeliveriesByFilters({ driverId: input.id }),
        fetchRecentDeliveriesForDriver(input.id, limit),
      ]);
      return {
        relation: input.relation,
        count: counts.total,
        counts: {
          total: counts.total,
          verified: counts.verified,
          pending: counts.pending,
          rejected: counts.rejected,
          cancelled: counts.cancelled,
          in_transit: counts.in_transit,
        },
        note: "capped_recent_head",
        head: head.map((row) => stripDeliveryHead(row as unknown as Record<string, unknown>)),
        focus: { entity_type: "driver", id: input.id, driver_id: input.id },
      };
    }
    return { relation: input.relation, error: "unavailable", reason: "unsupported_relation" };
  }

  return { relation: input.relation, error: "unavailable", reason: "unknown_relation" };
}
