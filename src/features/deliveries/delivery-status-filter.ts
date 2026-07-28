import { DELIVERY_STATUSES, type DeliveryStatus } from "./types";

export const DELIVERY_STATUS_FILTER_ALL = "all" as const;
export const DELIVERY_STATUS_FILTER_IN_PROGRESS = "in_progress" as const;

/** Statuses grouped under the combined "All in progress" list filter. */
export const IN_PROGRESS_DELIVERY_STATUSES = [
  "in_transit",
  "pending",
  "under_review",
] as const satisfies readonly DeliveryStatus[];

export type DeliveryStatusFilterValue =
  | typeof DELIVERY_STATUS_FILTER_ALL
  | typeof DELIVERY_STATUS_FILTER_IN_PROGRESS
  | DeliveryStatus;

/** All values for the deliveries list status dropdown (default: all). */
export function deliveryStatusFilterValues(): DeliveryStatusFilterValue[] {
  return [
    DELIVERY_STATUS_FILTER_ALL,
    DELIVERY_STATUS_FILTER_IN_PROGRESS,
    ...DELIVERY_STATUSES,
  ];
}

export function deliveryStatusMessageKey(status: DeliveryStatus): string {
  switch (status) {
    case "verified":
      return "statusVerified";
    case "rejected":
      return "statusRejected";
    case "under_review":
      return "statusUnderReview";
    case "in_transit":
      return "statusInTransit";
    case "cancelled":
      return "statusCancelled";
    case "pending":
    default:
      return "statusPending";
  }
}

export function deliveryStatusFilterMessageKey(
  value: DeliveryStatusFilterValue,
): string {
  if (value === DELIVERY_STATUS_FILTER_ALL) return "tabAll";
  if (value === DELIVERY_STATUS_FILTER_IN_PROGRESS) return "tabInProgressAll";
  return deliveryStatusMessageKey(value);
}

/** Normalize legacy filter aliases before querying. */
export function normalizeDeliveryStatusFilter(status: string): string {
  return status === "active" ? "in_transit" : status;
}
