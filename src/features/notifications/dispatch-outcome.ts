type DispatchOutcomeItem = {
  status: string;
  error_code: string | null;
  engagement_seen?: boolean;
};

/** Push was skipped because the driver has no active FCM token. Inbox row still exists. */
export function isPushSkippedNoToken(item: Pick<DispatchOutcomeItem, "error_code">): boolean {
  return item.error_code === "no_token";
}

/** Hard push failure (FCM error), not a missing-token skip. */
export function isHardPushFailure(item: Pick<DispatchOutcomeItem, "status" | "error_code">): boolean {
  if (isPushSkippedNoToken(item)) return false;
  return item.status === "failed";
}

export function summarizeDispatchOutcomes(items: DispatchOutcomeItem[]) {
  const pushSkipped = items.filter((i) => isPushSkippedNoToken(i)).length;
  const pushSent = items.filter(
    (i) =>
      !isPushSkippedNoToken(i) &&
      (i.status === "sent" ||
        i.status === "delivered" ||
        i.status === "opened" ||
        i.status === "clicked"),
  ).length;
  const hardFailed = items.filter((i) => isHardPushFailure(i)).length;
  const seen = items.filter((i) => i.engagement_seen).length;
  const allPushSkipped = items.length > 0 && pushSkipped === items.length;

  return {
    pushSkipped,
    pushSent,
    hardFailed,
    seen,
    allPushSkipped,
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
  items: Array<Pick<DispatchOutcomeItem, "status" | "error_code">>,
): string {
  const summary = summarizeDispatchOutcomes(items);
  if (campaignStatus === "failed" && summary.allPushSkipped) {
    return "sent";
  }
  return campaignStatus;
}
