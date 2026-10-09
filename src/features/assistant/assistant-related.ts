import { countDeliveriesByFilters, fetchRecentDeliveriesForDriver } from "@/features/deliveries/deliveries-actions";
import { getDriverGroup } from "@/features/driver-groups/driver-groups-actions";
import { fetchDriverDetail } from "@/features/drivers/drivers-actions";
import { fetchAdminRequestsList } from "@/features/requests/requests-actions";
import {
  REQUEST_OPEN_STATUSES,
  requestStatusLabel,
} from "@/features/requests/request-status-utils";
import { fetchRestaurantAssignedDrivers } from "@/features/restaurants/restaurants-actions";
import { logAdminRead } from "@/lib/audit/log-admin-activity";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { assistantModuleAllowed, requireAssistantModule } from "./assistant-gates";
import { ASSISTANT_SCAN_CAP, loadDocs, rowsWhere } from "./assistant-lookups";
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

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

async function profileNames(ids: string[]): Promise<Map<string, string | null>> {
  const db = await staffDb();
  const names = new Map<string, string | null>();
  if (!db || ids.length === 0) return names;
  const profiles = await loadDocs(db, COLLECTIONS.profiles, ids);
  for (const id of ids) names.set(id, asText(profiles.get(id)?.full_name));
  return names;
}

async function restaurantsInZone(zoneId: string, limit: number) {
  const rows = (await rowsWhere(COLLECTIONS.restaurants, "zone_id", zoneId, ASSISTANT_SCAN_CAP))
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
  return relatedPayload(
    rows.length,
    rows.slice(0, limit).map((row) => ({ id: row.id, name: row.name ?? null, status: row.status ?? null })),
  );
}

async function driversInZone(zoneId: string, limit: number) {
  const rows = (await rowsWhere(COLLECTIONS.drivers, "zone_id", zoneId, ASSISTANT_SCAN_CAP)).filter(
    (row) => row.archived_at == null,
  );
  const head = rows.slice(0, limit);
  const names = await profileNames(head.map((row) => String(row.id)));
  return relatedPayload(
    rows.length,
    head.map((row) => ({
      id: row.id,
      driver_code: row.driver_code,
      name: names.get(String(row.id)) ?? null,
    })),
  );
}

async function fleetDrivers(limit: number) {
  const rows = (await rowsWhere(COLLECTIONS.drivers, "is_on_duty", true, ASSISTANT_SCAN_CAP)).filter(
    (row) => row.archived_at == null && row.vehicle_id != null,
  );
  const head = rows.slice(0, limit);
  const names = await profileNames(head.map((row) => String(row.id)));
  return relatedPayload(
    rows.length,
    head.map((row) => ({
      id: row.id,
      driver_code: row.driver_code,
      vehicle_id: row.vehicle_id,
      name: names.get(String(row.id)) ?? null,
    })),
  );
}

async function vehicleForDriver(driverId: string) {
  const db = await staffDb();
  if (!db) return relatedPayload(0, []);
  const driver = (await loadDocs(db, COLLECTIONS.drivers, [driverId])).get(driverId);
  const vehicleId = asText(driver?.vehicle_id);
  if (!vehicleId) return relatedPayload(0, []);
  const vehicle = (await loadDocs(db, COLLECTIONS.vehicles, [vehicleId])).get(vehicleId);
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

    // "Pending" is a group of statuses, not one. Filtering the RPC to a single
    // `in_review` hid submitted / needs_clarification / rescheduled rows and
    // reported their count as zero. The list is fetched unfiltered by status
    // and narrowed here from the same `status_counts` the KPI strip uses, so
    // the head and the count cannot disagree.
    if (input.relation === "pending_requests") {
      const scanLimit = Math.min(Math.max(limit * 5, limit), 50);
      const list = await fetchAdminRequestsList({
        datePreset: "all",
        search,
        zoneId,
        type,
        status: input.status,
        limit: scanLimit,
        offset: 0,
      });
      const counts = list.statusCounts;
      const count = REQUEST_OPEN_STATUSES.reduce((sum, key) => sum + (counts[key] ?? 0), 0);
      const head = list.rows
        .filter((row) => (REQUEST_OPEN_STATUSES as readonly string[]).includes(String(row.status)))
        .slice(0, limit)
        .map((row) => stripRequestRow(row as unknown as Record<string, unknown>));
      return {
        relation: input.relation,
        count,
        filtered_total: list.filteredTotal,
        status_counts: counts,
        status_labels: Object.fromEntries(
          Object.entries(counts).map(([key]) => [key, requestStatusLabel(key)]),
        ),
        open_statuses: REQUEST_OPEN_STATUSES.map((key) => ({
          key,
          label: requestStatusLabel(key),
        })),
        note: "pending is the open statuses group, not a single status",
        head,
        focus: { entity_type: input.from_type, id: input.id },
      };
    }

    const list = await fetchAdminRequestsList({
      datePreset: "all",
      search,
      zoneId,
      type,
      status: input.status,
      limit,
      offset: 0,
    });
    return {
      relation: input.relation,
      count: list.filteredTotal,
      kpi: list.kpi,
      status_counts: Object.fromEntries(
        Object.entries(list.statusCounts).map(([key, value]) => [requestStatusLabel(key), value]),
      ),
      head: list.rows.map((row) => {
        const stripped = stripRequestRow(row as unknown as Record<string, unknown>);
        return { ...stripped, status_label: requestStatusLabel(String(row.status)) };
      }),
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
