function shortId(uuid: string): string {
  return uuid.slice(0, 8).toUpperCase();
}

export function liveOrderDisplayId(row: {
  external_order_id?: string | null;
  id: string;
}): string {
  const external = row.external_order_id?.trim();
  return external || shortId(row.id);
}

export function liveOrderTimestamp(row: {
  delivered_at?: string | null;
  created_at?: string | null;
}): string | null {
  return row.delivered_at ?? row.created_at ?? null;
}

export type LiveRecentOrderDisplayStatus =
  | "on_delivery"
  | "delivered"
  | "pending"
  | "verified"
  | "rejected"
  | "under_review"
  | "cancelled";

/** Live Tracking recent-order chip — not the Deliveries review queue labels. */
export function liveRecentOrderDisplayStatus(order: {
  status: "pending" | "verified" | "rejected" | "under_review" | "in_transit" | "cancelled";
  deliveredAt?: string | null;
}): LiveRecentOrderDisplayStatus {
  if (order.status === "in_transit") return "on_delivery";
  if (
    (order.status === "pending" || order.status === "under_review") &&
    order.deliveredAt
  ) {
    return "delivered";
  }
  return order.status;
}
