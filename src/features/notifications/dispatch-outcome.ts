type DispatchOutcomeItem = {
  status: string;
  error_code: string | null;
  engagement_seen?: boolean;
  provider_message_id?: string | null;
};

/** Push was skipped because the driver has no active FCM token. Inbox row still exists. */
export function isPushSkippedNoToken(item: Pick<DispatchOutcomeItem, "error_code">): boolean {
  return item.error_code === "no_token";
}

/**
 * Hard push failure (FCM / credential error), not a missing-token skip.
 * Inbox may later mark the row `opened` — keep treating push as failed when
 * an FCM error_code is still stored.
 */
export function isHardPushFailure(
  item: Pick<DispatchOutcomeItem, "status" | "error_code" | "provider_message_id">,
): boolean {
  if (isPushSkippedNoToken(item)) return false;
  const code = item.error_code?.trim() ?? "";
  if (code) {
    if (
      code.startsWith("messaging/") ||
      code.startsWith("app/") ||
      code === "firebase_not_configured" ||
      code === "unknown"
    ) {
      return true;
    }
  }
  return item.status === "failed";
}

export function summarizeDispatchOutcomes(items: DispatchOutcomeItem[]) {
  const pushSkipped = items.filter((i) => isPushSkippedNoToken(i)).length;
  const hardFailed = items.filter((i) => isHardPushFailure(i)).length;
  const pushSent = items.filter(
    (i) =>
      !isPushSkippedNoToken(i) &&
      !isHardPushFailure(i) &&
      (i.status === "sent" ||
        i.status === "delivered" ||
        i.status === "opened" ||
        i.status === "clicked" ||
        Boolean(i.provider_message_id)),
  ).length;
  const seen = items.filter((i) => i.engagement_seen).length;
  const allPushSkipped = items.length > 0 && pushSkipped === items.length;
  const allHardFailed = items.length > 0 && hardFailed === items.length;
  const inboxOpenedCount = items.filter(
    (i) =>
      i.engagement_seen ||
      i.status === "opened" ||
      i.status === "clicked",
  ).length;

  return {
    pushSkipped,
    pushSent,
    hardFailed,
    seen,
    allPushSkipped,
    allHardFailed,
    inboxOpenedCount,
    /** Inbox fan-out succeeded for every recipient when dispatch items exist. */
    inboxDelivered: items.length,
  };
}

/**
 * Campaigns that only skipped push (no token) still delivered in-app inbox rows.
 * Treat those as successful sends for status display — not wholesale failures.
 */
export function resolveCampaignDisplayStatus(
  campaignStatus: string,
  items: Array<
    Pick<DispatchOutcomeItem, "status" | "error_code" | "provider_message_id">
  >,
): string {
  const summary = summarizeDispatchOutcomes(items);
  if (summary.allPushSkipped) {
    return "sent";
  }
  if (summary.allHardFailed) {
    return "failed";
  }
  if (campaignStatus === "failed" && summary.hardFailed === 0 && summary.pushSent > 0) {
    return "sent";
  }
  return campaignStatus;
}
