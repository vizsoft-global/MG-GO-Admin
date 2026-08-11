export type RequestStatusVariant = "success" | "warning" | "danger" | "info" | "neutral";

/**
 * Distinct color per status so adjacent rows pass the squint test (ui-system.mdc §5).
 * Figma "Status & Acknowledgement Conventions" (node 4321:8349):
 * Pending/needs_clarification = orange, In review/submitted = blue, Approved/Solved = green,
 * Rejected/Overdue = red, Draft = neutral, Awaiting acknowledgement = amber (approved + payload flag).
 */
export function requestStatusVariant(
  status: string,
  payload?: Record<string, unknown> | null,
): RequestStatusVariant {
  if (isAwaitingDriverAck(status, payload)) return "warning";
  if (isDriverAcknowledged(status, payload)) return "success";
  if (status === "approved" || status === "solved") return "success";
  if (status === "rejected" || status === "overdue") return "danger";
  if (status === "pending" || status === "needs_clarification") return "warning";
  if (status === "in_review" || status === "submitted") return "info";
  return "neutral";
}

export function isAwaitingDriverAck(
  status: string,
  payload?: Record<string, unknown> | null,
): boolean {
  return status === "approved" && Boolean(payload?.awaiting_driver_ack);
}

/** `driver_acknowledge_request` stamps `driver_ack_at` and clears the awaiting flag. */
export function isDriverAcknowledged(
  status: string,
  payload?: Record<string, unknown> | null,
): boolean {
  return status === "approved" && Boolean(payload?.driver_ack_at);
}

/** i18n key under pages.requests.status.* — "awaiting_ack" overlays "approved" until the driver confirms. */
export function requestStatusLabelKey(
  status: string,
  payload?: Record<string, unknown> | null,
): string {
  if (isAwaitingDriverAck(status, payload)) return "awaiting_ack";
  if (isDriverAcknowledged(status, payload)) return "acknowledged";
  return status;
}
