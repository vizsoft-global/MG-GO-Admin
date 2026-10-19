export type OrderExceptionKind = "rejected" | "cancelled";
export type OrderExceptionSource = "driver_declined" | "store_or_customer";
export type OrderExceptionStatus = "pending" | "approved" | "rejected";
export type OrderExceptionDecision = "approved" | "rejected";
export type OrderExceptionTab = "all" | OrderExceptionStatus;

export type OrderExceptionStatusFilter = "all" | OrderExceptionStatus;
export type OrderExceptionKindFilter = "all" | OrderExceptionKind;
export type OrderExceptionSourceFilter = "all" | OrderExceptionSource;

/** Mirrors MAX_PROOFS in functions/src/rpcs/order-exceptions.ts. */
export const ORDER_EXCEPTION_MAX_PROOF_KEYS = 5;
export const ORDER_EXCEPTION_PAGE_SIZE = 50;

export const ORDER_EXCEPTION_KINDS: readonly OrderExceptionKind[] = ["rejected", "cancelled"];
export const ORDER_EXCEPTION_SOURCES: readonly OrderExceptionSource[] = [
  "driver_declined",
  "store_or_customer",
];
export const ORDER_EXCEPTION_STATUSES: readonly OrderExceptionStatus[] = [
  "pending",
  "approved",
  "rejected",
];

export function isOrderExceptionKind(value: unknown): value is OrderExceptionKind {
  return value === "rejected" || value === "cancelled";
}

export function isOrderExceptionSource(value: unknown): value is OrderExceptionSource {
  return value === "driver_declined" || value === "store_or_customer";
}

export function isOrderExceptionStatus(value: unknown): value is OrderExceptionStatus {
  return value === "pending" || value === "approved" || value === "rejected";
}

/** One proof screenshot, already signed for a short-lived read on the server. */
export type OrderExceptionProof = {
  /** The R2 object key this preview resolves — never used as an <img> src. */
  key: string;
  /** Signed GET url, or the stored external link. Always browser-loadable. */
  url: string;
  /** True when the resolved content type is an image; anything else is opened, not embedded. */
  isImage: boolean;
  /** A proof stored as an external link rather than an R2 key. */
  isLink: boolean;
};

/** A row exactly as the callable returns it, minus the raw `proof_keys`. */
export type OrderExceptionRow = {
  id: string;
  created_at: string | null;
  updated_at: string | null;
  /** Kuwait day the exception was declared on (`YYYY-MM-DD`). */
  day: string | null;
  driver_id: string | null;
  driver_code: string | null;
  driver_name: string | null;
  kind: OrderExceptionKind;
  source: OrderExceptionSource;
  status: OrderExceptionStatus;
  order_id: string | null;
  delivery_id: string | null;
  restaurant_id: string | null;
  restaurant_name: string | null;
  reason: string | null;
  /** Count only — the keys themselves never cross the wire. */
  proof_count: number;
  /** Signed proofs for this row. Empty when the object could not be resolved. */
  proofs: OrderExceptionProof[];
  reviewed_at: string | null;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  review_note: string | null;
  counted_as_exception: boolean;
};

export type OrderExceptionDateRange = {
  from?: string;
  to?: string;
};

export type OrderExceptionListFilters = {
  status?: OrderExceptionStatusFilter;
  kind?: OrderExceptionKindFilter;
  source?: OrderExceptionSourceFilter;
  driverId?: string;
  /** Inclusive Kuwait day bounds, `YYYY-MM-DD`. */
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export type OrderExceptionCounts = {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
};

export type OrderExceptionListResult = {
  rows: OrderExceptionRow[];
  total: number;
  counts: OrderExceptionCounts;
  offset: number;
  limit: number;
};

export type OrderExceptionSummary = {
  pending: number;
  approved: number;
  rejected: number;
  rejected_orders: number;
  cancelled_orders: number;
  driver_declined: number;
  store_or_customer: number;
  total: number;
};

export type OrderExceptionProofsResult = {
  id: string;
  proofs: OrderExceptionProof[];
};

export type ReviewOrderExceptionInput = {
  id: string;
  decision: OrderExceptionDecision;
  note?: string;
};

export type ReviewOrderExceptionResult = {
  ok: boolean;
  id: string;
  status: OrderExceptionStatus;
};

export type OrderExceptionErrorCode =
  | "not_authorized"
  | "not_configured"
  | "invalid_input"
  | "review_note_required"
  | "unknown";

export type OrderExceptionActionResult<T> = {
  data: T | null;
  error: OrderExceptionErrorCode | null;
};

export const ORDER_EXCEPTION_STATUS_LABEL: Record<OrderExceptionStatus, string> = {
  pending: "statusPending",
  approved: "statusApproved",
  rejected: "statusRejected",
};

export const ORDER_EXCEPTION_KIND_LABEL: Record<OrderExceptionKind, string> = {
  rejected: "kindRejected",
  cancelled: "kindCancelled",
};

export const ORDER_EXCEPTION_SOURCE_LABEL: Record<OrderExceptionSource, string> = {
  driver_declined: "sourceDriver",
  store_or_customer: "sourceStore",
};

/** The subset of the callable's `Row` this panel relies on. */
export type RawOrderExceptionRow = Record<string, unknown>;
