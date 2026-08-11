export type RequestStatusVariant = "success" | "warning" | "danger" | "info" | "neutral";

/** Distinct color per status so adjacent rows pass the squint test (ui-system.mdc §5). */
export function requestStatusVariant(status: string): RequestStatusVariant {
  if (status === "approved" || status === "solved") return "success";
  if (status === "rejected" || status === "overdue") return "danger";
  if (status === "pending" || status === "needs_clarification") return "warning";
  if (status === "in_review" || status === "submitted") return "info";
  return "neutral";
}
