import type { DeliveryListRow } from "./types";

/** Latest activity timestamp for sorting (cancel > deliver > pickup > created). */
export function deliveryActivityAt(row: Pick<
  DeliveryListRow,
  "cancelled_at" | "delivered_at" | "pickup_at" | "created_at"
>): string {
  return row.cancelled_at ?? row.delivered_at ?? row.pickup_at ?? row.created_at;
}

export function sortDeliveriesByActivity(rows: DeliveryListRow[]): DeliveryListRow[] {
  return [...rows].sort((a, b) => {
    const aTs = new Date(deliveryActivityAt(a)).getTime();
    const bTs = new Date(deliveryActivityAt(b)).getTime();
    return bTs - aTs;
  });
}

export function formatRelativeMinutesAgo(
  iso: string,
  nowMs: number = Date.now(),
): number {
  const diffMs = nowMs - new Date(iso).getTime();
  return Math.max(0, Math.floor(diffMs / 60_000));
}
