import {
  resolveStatusVariant,
  type StatusVariant,
} from "@/lib/ui/resolve-status-variant";

/** StatusPill variants used by delivery chips (includes app-only pending + in-transit). */
export type DeliveryStatusPillVariant = StatusVariant | "info" | "pending";

function normalizeDeliveryStatus(status: string | null | undefined): string {
  return status?.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? "";
}

/**
 * Delivery chips follow the driver app:
 * Pending = tomato, Under Review = amber, Cancelled = grey, In transit = blue.
 */
export function resolveDeliveryStatusVariant(
  status: string | null | undefined,
): DeliveryStatusPillVariant {
  const normalized = normalizeDeliveryStatus(status);
  switch (normalized) {
    case "verified":
    case "delivered":
      return "success";
    case "rejected":
      return "danger";
    case "under_review":
    case "review":
      return "warning";
    case "cancelled":
    case "canceled":
      return "neutral";
    case "in_transit":
    case "active":
      return "info";
    case "pending":
      return "pending";
    default:
      return resolveStatusVariant(status);
  }
}
