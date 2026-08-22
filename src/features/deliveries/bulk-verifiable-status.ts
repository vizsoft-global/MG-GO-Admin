/** Statuses that bulk Verify / Reject may change. Live and terminal rows stay skipped. */
export const BULK_VERIFIABLE_DELIVERY_STATUSES = [
  "pending",
  "under_review",
] as const;

export function isBulkVerifiableDeliveryStatus(status: string): boolean {
  return (
    status === "pending" ||
    status === "under_review"
  );
}
