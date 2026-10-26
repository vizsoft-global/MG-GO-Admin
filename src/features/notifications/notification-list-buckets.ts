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

export function parseListBucket(value: string | null | undefined): NotificationListBucket {
  if (value === "sent" || value === "drafts" || value === "scheduled" || value === "failed") {
    return value;
  }
  return "all";
}
