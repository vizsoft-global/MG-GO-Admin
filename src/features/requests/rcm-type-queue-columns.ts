import { parseRequestListScope, type RequestListScope } from "./request-list-scopes";

/** System request types the per-type queue knows how to column. */
export const RCM_QUEUE_TYPES = [
  "loan",
  "leave",
  "sick_leave",
  "fuel",
  "fuel_refund",
  "asset",
  "complaint",
  "salary_justification",
  "document",
] as const;

export type RcmQueueType = (typeof RCM_QUEUE_TYPES)[number];

export type RcmQueueScope = "assigned" | "forwarded" | "handled" | "all";

export type QueueColumnKey =
  | "amount"
  | "repayment"
  | "fromTo"
  | "days"
  | "vehicle"
  | "item"
  | "category"
  | "severity"
  | "month"
  | "subject";

export type RequestQueueFact = {
  tenureMonths: string | null;
  startDate: string | null;
  endDate: string | null;
  vehicleLabel: string | null;
  item: string | null;
  category: string | null;
  month: string | null;
  subject: string | null;
};

const OPEN_STATUSES = new Set([
  "submitted",
  "pending",
  "in_review",
  "needs_clarification",
  "rescheduled",
  "overdue",
]);

/** Same 15-day window as `admin_list_requests` overdue KPI. */
const OVERDUE_MS = 15 * 24 * 60 * 60 * 1000;

export function isRcmQueueType(value: string | undefined | null): value is RcmQueueType {
  return value != null && (RCM_QUEUE_TYPES as readonly string[]).includes(value);
}

/**
 * Waiting on you → assigned (and the existing `action` alias, which sets the
 * same assigned-to-me flag). Handled by me → the existing `handled` scope.
 * `due` is a filter, not a tab, so it lands on Waiting on you.
 */
export function queueScopeFromParam(value: string | undefined | null): RcmQueueScope {
  const parsed: RequestListScope = parseRequestListScope(value);
  switch (parsed) {
    case "assigned":
    case "action":
      return "assigned";
    case "forwarded":
      return "forwarded";
    case "handled":
      return "handled";
    case "all":
      return "all";
    case "due":
    case null:
      return "assigned";
    default: {
      const unreachable: never = parsed;
      return unreachable;
    }
  }
}

export function queueColumnKeys(type: RcmQueueType): readonly QueueColumnKey[] {
  switch (type) {
    case "loan":
      return ["amount", "repayment"];
    case "leave":
    case "sick_leave":
      return ["fromTo", "days"];
    case "fuel":
    case "fuel_refund":
      return ["amount", "vehicle"];
    case "asset":
      return ["item"];
    case "complaint":
      return ["category", "severity"];
    case "salary_justification":
      return ["month"];
    case "document":
      return ["subject"];
    default: {
      const unreachable: never = type;
      return unreachable;
    }
  }
}

export function queueDayCount(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const from = Date.parse(start);
  const to = Date.parse(end);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  const days = Math.round((to - from) / 86_400_000) + 1;
  return days > 0 ? String(days) : null;
}

export function isQueueRowOverdue(
  input: { status: string; createdAt: string; slaDueAt: string | null },
  now = Date.now(),
): boolean {
  if (!OPEN_STATUSES.has(input.status)) return false;
  if (input.slaDueAt) {
    const due = new Date(input.slaDueAt).getTime();
    if (!Number.isNaN(due) && due < now) return true;
  }
  const created = new Date(input.createdAt).getTime();
  return !Number.isNaN(created) && created < now - OVERDUE_MS;
}
