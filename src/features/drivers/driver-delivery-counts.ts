/** Timestamp used to put a delivery in today / this-week Quick Stats. */
export function deliveryActivityAt(row: {
  created_at: string;
  pickup_at: string | null;
  delivered_at: string | null;
}): string {
  return row.delivered_at ?? row.pickup_at ?? row.created_at;
}

export function countDeliveriesInWindow(
  rows: Array<{
    status: string;
    created_at: string;
    pickup_at: string | null;
    delivered_at: string | null;
  }>,
  startIso: string,
  endIso: string,
): number {
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  return rows.filter((row) => {
    if (row.status === "cancelled") return false;
    const atMs = Date.parse(deliveryActivityAt(row));
    if (!Number.isFinite(atMs) || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return false;
    }
    return atMs >= startMs && atMs <= endMs;
  }).length;
}
