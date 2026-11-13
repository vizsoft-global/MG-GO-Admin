/**
 * One vocabulary for "how many orders".
 *
 * The client's 4.2 report was that four surfaces answered that question four
 * different ways for the same rider and period. There are exactly **two** honest
 * numbers in this schema, and every surface has to say which one it means:
 *
 * - **recorded** — the rider completed the order. `pending` (delivered, waiting
 *   for the office) plus `under_review` plus `verified`. This is what
 *   "all orders recorded in the application" means, and it is what Payroll and
 *   HR Payroll print.
 * - **verified** — the office has confirmed it. This is the payout basis, and it
 *   is what Earnings prices.
 *
 * `in_transit` is in neither: the rider has collected the order but not
 * finished it, so counting it would pay for work still in progress.
 * `rejected` and `cancelled` are in neither for the opposite reason.
 *
 * Keeping the two apart in one file is what stops a surface from quietly
 * inventing a third.
 */

/** Statuses that mean "this order was completed". */
export const RECORDED_ORDER_STATUSES = ["pending", "under_review", "verified"] as const;

/** Statuses that mean "the office confirmed this order". */
export const VERIFIED_ORDER_STATUSES = ["verified"] as const;

export type RollupOrderCounts = {
  /** The verified counter. */
  verified?: number | null;
  /** Legacy alias of `verified`; some rows carry only this one. */
  orders?: number | null;
  pending?: number | null;
  under_review?: number | null;
};

function count(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Verified orders on a rollup day.
 *
 * `max(verified, orders)` rather than one field: `orders` is the counter the
 * first rollup writer created and `verified` was added beside it, so a row
 * written by either writer is read correctly. They track the same status, so the
 * maximum is the count and never a sum.
 */
export function verifiedOrdersOf(row: RollupOrderCounts): number {
  return Math.max(count(row.verified), count(row.orders));
}

/**
 * Every completed order on a rollup day: waiting for the office, under review,
 * or already verified.
 *
 * `under_review` used to be omitted, so a day whose deliveries all sat in that
 * state read **0 orders** while the Deliveries list showed them — the exact
 * "orders are not reflected in Payroll" the client reported.
 */
export function recordedOrdersOf(row: RollupOrderCounts): number {
  return verifiedOrdersOf(row) + count(row.pending) + count(row.under_review);
}

/** True when the status is one a completed order can be in. */
export function isRecordedOrderStatus(status: string): boolean {
  return (RECORDED_ORDER_STATUSES as readonly string[]).includes(status);
}
