export function visitStatusVariant(
  status: string,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "completed" || status === "checked_in") return "success";
  if (status === "cancelled" || status === "no_show") return "danger";
  if (status === "confirmed") return "warning";
  return "neutral";
}

export const VISIT_STATUSES = [
  "confirmed",
  "checked_in",
  "completed",
  "no_show",
  "cancelled",
] as const;

export type VisitBookingStatus = (typeof VISIT_STATUSES)[number];

export const DAY_OF_WEEK_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;
