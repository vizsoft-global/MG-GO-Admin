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

/** Read a `?status=` value, falling back to "all" for anything not in the enum. */
export function parseDeliveryStatusFilter(
  value: string | null,
): DeliveryStatusFilterValue {
  if (!value) return DELIVERY_STATUS_FILTER_ALL;
  return (deliveryStatusFilterValues() as readonly string[]).includes(value)
    ? (value as DeliveryStatusFilterValue)
    : DELIVERY_STATUS_FILTER_ALL;
}

/** Build the list href for a status, dropping `status` entirely for "all". */
export function deliveryListHref(
  pathname: string,
  value: DeliveryStatusFilterValue,
  params?: URLSearchParams,
): string {
  const next = new URLSearchParams(params?.toString() ?? "");
  if (value === DELIVERY_STATUS_FILTER_ALL) next.delete("status");
  else next.set("status", value);
  const qs = next.toString();
  return qs ? `${pathname}?${qs}` : pathname;
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
