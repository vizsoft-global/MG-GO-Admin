export type ExactCountResult = {
  count: number | null;
  error: { message: string } | null;
};

export function readExactCount(result: ExactCountResult): number {
  if (result.error) throw new Error(result.error.message);
  return result.count ?? 0;
}

export type DeliveriesStatusCounts = {
  total: number;
  active: number;
  verified: number;
  pending: number;
  rejected: number;
  cancelled: number;
  under_review: number;
  in_progress: number;
};

function asCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

/** Parse `admin_deliveries_status_counts` jsonb. */
export function parseDeliveriesStatusCounts(raw: unknown): DeliveriesStatusCounts {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    total: asCount(row.total),
    active: asCount(row.active),
    verified: asCount(row.verified),
    pending: asCount(row.pending),
    rejected: asCount(row.rejected),
    cancelled: asCount(row.cancelled),
    under_review: asCount(row.under_review),
    in_progress: asCount(row.in_progress),
  };
}

/** List "Showing X of Y" total for the status dropdown. */
export function listTotalFromStatusCounts(
  counts: DeliveriesStatusCounts,
  status: string | undefined,
): number {
  const key = status === "active" ? "in_transit" : (status ?? "all");
  switch (key) {
    case "all":
      return counts.total;
    case "in_progress":
      return counts.in_progress;
    case "in_transit":
      return counts.active;
    case "verified":
      return counts.verified;
    case "pending":
      return counts.pending;
    case "rejected":
      return counts.rejected;
    case "cancelled":
      return counts.cancelled;
    case "under_review":
      return counts.under_review;
    default:
      return counts.total;
  }
}
