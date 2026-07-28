import type { DeliveryStatus } from "@/features/deliveries/types";
import type {
  RestaurantActivityEvent,
  RestaurantActivityKind,
  RestaurantDeliveryStats,
} from "./types";

export type ScopedDeliveryRow = {
  id: string;
  driver_id: string;
  partner_id: string | null;
  restaurant_id: string | null;
  status: DeliveryStatus;
  external_order_id: string | null;
  pickup_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  driver_name?: string;
  driver_code?: string;
};

export function shortDeliveryId(uuid: string): string {
  return uuid.slice(0, 8).toUpperCase();
}

export function isDeliveryForRestaurant(
  delivery: Pick<
    ScopedDeliveryRow,
    "restaurant_id" | "driver_id" | "partner_id"
  >,
  restaurantId: string,
  restaurantPartnerId: string | null,
  assignedDriverIds: ReadonlySet<string>,
): boolean {
  if (delivery.restaurant_id === restaurantId) return true;
  if (delivery.restaurant_id != null) return false;
  if (!assignedDriverIds.has(delivery.driver_id)) return false;
  if (!restaurantPartnerId || delivery.partner_id !== restaurantPartnerId) {
    return false;
  }
  return true;
}

export function emptyDeliveryStats(): RestaurantDeliveryStats {
  return {
    active_deliveries: 0,
    deliveries_total: 0,
    deliveries_verified: 0,
    deliveries_cancelled: 0,
    cancelled_today: 0,
  };
}

export function computeDeliveryStats(
  deliveries: ScopedDeliveryRow[],
  todayStr?: string,
): RestaurantDeliveryStats {
  const kuwaitToday =
    todayStr ??
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuwait" }).format(
      new Date(),
    );

  let active = 0;
  let verified = 0;
  let cancelled = 0;
  let cancelledToday = 0;

  for (const d of deliveries) {
    if (d.status === "in_transit") active += 1;
    if (d.status === "verified") verified += 1;
    if (d.status === "cancelled") {
      cancelled += 1;
      if (d.cancelled_at) {
        try {
          const dDate = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Kuwait",
          }).format(new Date(d.cancelled_at));
          if (dDate === kuwaitToday) cancelledToday += 1;
        } catch {
          /* ignore */
        }
      }
    }
  }

  return {
    active_deliveries: active,
    deliveries_total: deliveries.length,
    deliveries_verified: verified,
    deliveries_cancelled: cancelled,
    cancelled_today: cancelledToday,
  };
}

export function buildActivityLogFromDeliveries(
  deliveries: ScopedDeliveryRow[],
  limit = 100,
): RestaurantActivityEvent[] {
  const events: RestaurantActivityEvent[] = [];

  for (const d of deliveries) {
    const driverName = d.driver_name ?? "—";
    const driverCode = d.driver_code ?? "—";
    const base = {
      delivery_id: d.id,
      short_id: shortDeliveryId(d.id),
      driver_name: driverName,
      driver_code: driverCode,
      external_order_id: d.external_order_id,
      status: d.status,
    };

    if (d.pickup_at) {
      events.push({
        ...base,
        at: d.pickup_at,
        kind: "pickup" as RestaurantActivityKind,
      });
    }

    if (d.status === "in_transit" && d.pickup_at) {
      events.push({
        ...base,
        at: d.pickup_at,
        kind: "in_transit",
      });
    }

    if (d.delivered_at) {
      events.push({
        ...base,
        at: d.delivered_at,
        kind: "delivered",
      });
    }

    if (d.cancelled_at) {
      events.push({
        ...base,
        at: d.cancelled_at,
        kind: "cancelled",
        cancel_reason: d.cancel_reason,
      });
    }
  }

  return events
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);
}
