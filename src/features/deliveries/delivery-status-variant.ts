import {
  resolveStatusVariant,
  type StatusVariant,
} from "@/lib/ui/resolve-status-variant";

/** Delivery chips follow the driver app: Under Review = amber, Cancelled = grey. */
export function resolveDeliveryStatusVariant(
  status: string | null | undefined,
): StatusVariant {
  const normalized = status?.trim().toLowerCase().replace(/\s+/g, "_") ?? "";
  if (normalized === "under_review") return "warning";
  if (normalized === "cancelled" || normalized === "canceled") return "neutral";
  return resolveStatusVariant(status);
}
