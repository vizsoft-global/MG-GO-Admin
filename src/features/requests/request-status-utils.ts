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

/** A row the All Requests bulk bar can act on — approve, reject, or both. */
/**
 * Whether the All Requests list paints a selection checkbox on a row.
 *
 * Selectable: `submitted`, `pending`, `in_review`, `needs_clarification`,
 * `rescheduled` and `overdue` — every status the bulk bar can still act on.
 * (`overdue` is derived from the SLA breach rather than stored, and rows reached
 * through that filter still carry one of the open statuses above.)
 *
 * Not selectable: `approved`, `rejected`, `solved`, `responded`, `closed`. Those
 * are decided outcomes and the bulk bar offers no verb for them — the only
 * remaining action is the per-row Archive on the detail page — so a checkbox on
 * one is a control whose sole outcome is an error, which reads as broken rather
 * than as "not applicable".
 *
 * Deliberately the complement of `REQUEST_DECIDED_STATUSES` instead of its own
 * allowlist, so the two can never disagree: a new status added to the enum
 * arrives with a checkbox rather than silently without one.
 *
 * A box promises a tick, not every button: `admin_decide_request` still refuses
 * per action — Approve is rejected on a `needs_clarification` row while Reject is
 * allowed — and the bulk bar narrows its buttons to the actions that apply.
 */
export function canBulkSelectRequest(status: string): boolean {
  return !REQUEST_DECIDED_STATUSES.has(status);
}

/**
 * The stored statuses whose queue is still waiting on someone. `overdue` is
 * deliberately absent: it is derived from the SLA breach, not a stored state, so
 * it belongs to the filter list rather than to this one.
 */
export const REQUEST_OPEN_STATUSES = [
  "pending",
  "submitted",
  "in_review",
  "needs_clarification",
  "rescheduled",
] as const;

/**
 * Enum → the wording a person reads. The database stores `in_review`; the panel
 * and the rider app show "In Progress", and an assistant answer that echoes the
 * raw enum reads as a different status to the operator.
 */
export const REQUEST_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  submitted: "Submitted",
  in_review: "In Progress",
  needs_clarification: "Needs clarification",
  rescheduled: "Rescheduled",
  approved: "Approved",
  rejected: "Rejected",
  solved: "Solved",
  responded: "Responded",
  closed: "Closed",
  overdue: "Overdue",
};

export function requestStatusLabel(status: string): string {
  return REQUEST_STATUS_LABELS[status] ?? status;
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
  if (type === "fuel" || type === "fuel_refund" || type === "asset") {
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

/**
 * The approver asked a question and the rider has not answered yet.
 *
 * `admin_decide_request` refuses to advance the request in this state
 * (`awaiting_driver_clarification`), so the detail page must not offer Approve /
 * Solve / Reschedule. Unlike a reschedule there is nothing to wait on in the
 * payload — the status itself is the fact — and Reject / Clarify stay allowed.
 */
export function isAwaitingDriverClarification(status: string): boolean {
  return status === "needs_clarification";
}

/** An advancing action the server refuses while the rider owes an answer. */
export function isAdvancingRequestAction(action: string): boolean {
  return action !== "reject" && action !== "clarify" && action !== "close";
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
