export type RequestStatusVariant = "success" | "warning" | "danger" | "info" | "neutral";

export const REQUEST_STATUS_FILTERS = [
  "all",
  "submitted",
  "pending",
  "in_review",
  "needs_clarification",
  "rescheduled",
  "approved",
  "rejected",
  "solved",
  "responded",
  "closed",
  "overdue",
] as const;

export type RequestStatusFilter = (typeof REQUEST_STATUS_FILTERS)[number];

/**
 * Outcomes that have already been decided. Selecting one cannot open
 * Approve / Reject, so the All Requests list must not paint a checkbox.
 * `responded` and `closed` sit here too — they are finished, not pending.
 */
export const REQUEST_DECIDED_STATUSES = new Set([
  "approved",
  "rejected",
  "solved",
  "responded",
  "closed",
]);

/** A row the bulk bar can act on — approve, reject, or both. */
export function canBulkSelectRequest(status: string): boolean {
  return !REQUEST_DECIDED_STATUSES.has(status);
}

/**
 * Fuel and asset only approve / reject / clarify — these queues never receive
 * a row of either type. Loan can reschedule; complaints can solve / respond.
 */
const UNUSED_ACTION_STATUS_FILTERS = new Set<RequestStatusFilter>([
  "rescheduled",
  "overdue",
  "solved",
  "responded",
]);

export function statusFiltersForRequestType(
  type: string,
): readonly RequestStatusFilter[] {
  if (type === "fuel" || type === "asset") {
    return REQUEST_STATUS_FILTERS.filter((key) => !UNUSED_ACTION_STATUS_FILTERS.has(key));
  }
  return REQUEST_STATUS_FILTERS;
}

/**
 * Distinct color per status so adjacent rows pass the squint test (ui-system.mdc §5).
 * Figma "Status & Acknowledgement Conventions" (node 4321:8349):
 * Pending/needs_clarification = orange, In review/submitted = blue, Approved/Solved = green,
 * Rejected/Overdue = red, Draft = neutral, Awaiting acknowledgement = amber (approved + payload flag).
 *
 * `rescheduled` is amber because it is waiting on the rider, like a clarification.
 * `responded` is green because it is a resolved outcome. `closed` is neutral — archived, done.
 */
export function requestStatusVariant(
  status: string,
  payload?: Record<string, unknown> | null,
): RequestStatusVariant {
  if (isAwaitingDriverAck(status, payload)) return "warning";
  if (isDriverAcknowledged(status, payload)) return "success";
  if (status === "approved" || status === "solved" || status === "responded") return "success";
  if (status === "rejected" || status === "overdue") return "danger";
  if (
    status === "pending" ||
    status === "needs_clarification" ||
    status === "rescheduled"
  ) {
    return "warning";
  }
  if (status === "in_review" || status === "submitted") return "info";
  return "neutral";
}

/** The approver proposed dates and the rider has not answered yet. */
export function isAwaitingRescheduleReply(
  status: string,
  payload?: Record<string, unknown> | null,
): boolean {
  return status === "rescheduled" && Boolean(payload?.awaiting_driver_reschedule);
}

/** A request that has been decided can be archived, but only once. */
export function canCloseRequest(
  status: string,
  completedAt: string | null,
): boolean {
  return status !== "closed" && completedAt != null;
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
