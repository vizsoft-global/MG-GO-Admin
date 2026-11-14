/**
 * Which `deliveries` statuses the Performance page's delivered slice keeps.
 *
 * The handler has always filtered these in memory, after a range read of
 * `delivered_at`. That read pulled every delivery in the window — including
 * `rejected`, `cancelled` and `under_review` — and threw the unwanted ones away
 * one document at a time, which is most of the 86,498 documents measured on a
 * two-week window. Pushing the same list into the query as `status in […]` is
 * the identical answer over fewer documents, because anything outside this list
 * was already being discarded before it reached the aggregation.
 *
 * The two sides must stay one list: if the in-memory filter ever admitted a
 * status this function drops, the query would silently under-count it.
 */
export const DELIVERED_SLICE_STATUSES = ["verified", "pending"] as const;

export function deliveredSliceStatuses(counted: readonly string[]): string[] {
  return counted.filter((status) =>
    (DELIVERED_SLICE_STATUSES as readonly string[]).includes(status),
  );
}

/** Open orders carry no `delivered_at`, so they are read on `pickup_at` instead. */
export function openSliceStatuses(counted: readonly string[]): string[] {
  return counted.filter((status) => status === "in_transit");
}
