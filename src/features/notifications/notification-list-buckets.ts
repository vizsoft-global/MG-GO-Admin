export const NOTIFICATION_LIST_BUCKETS = ["all", "sent", "drafts", "scheduled", "failed"] as const;

export type NotificationListBucket = (typeof NOTIFICATION_LIST_BUCKETS)[number];

const BUCKET_STATUSES = {
  sent: ["sent", "delivered", "opened", "clicked"],
  drafts: ["draft"],
  scheduled: ["scheduled", "pending_approval", "queued", "processing"],
  failed: ["failed", "cancelled", "expired"],
} as const;

export function statusesForListBucket(bucket: NotificationListBucket): readonly string[] | null {
  switch (bucket) {
    case "all":
      return null;
    case "sent":
    case "drafts":
    case "scheduled":
    case "failed":
      return BUCKET_STATUSES[bucket];
    default: {
      const neverBucket: never = bucket;
      return neverBucket;
    }
  }
}

/**
 * Does a stored campaign status belong to this bucket?
 *
 * The server query already filters on the same set, so this is the client-side guard
 * for the one case the query cannot cover: a page of rows fetched for a previous
 * filter that is still in memory while the new one loads. Without it, clicking
 * "Drafts" could paint sent rows under a card that counts 26.
 */
export function statusInListBucket(
  bucket: NotificationListBucket,
  status: string | null | undefined,
): boolean {
  const statuses = statusesForListBucket(bucket);
  if (!statuses) return true;
  return typeof status === "string" && statuses.includes(status);
}

export function parseListBucket(value: string | null | undefined): NotificationListBucket {
  if (value === "sent" || value === "drafts" || value === "scheduled" || value === "failed") {
    return value;
  }
  return "all";
}
