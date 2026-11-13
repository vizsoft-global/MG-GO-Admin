/**
 * One order count, one day, across the four surfaces the client compared.
 *
 * This is a source-level guard, like `order-comparison-caps.test.ts`, because the
 * four readers live in Cloud Functions that the panel cannot import. The failure
 * they cause is silent: each surface answers a perfectly plausible number, and
 * only a side-by-side comparison reveals that Payroll says 12, Earnings says 9
 * and Performance says 11 for the same rider and day.
 *
 * The contract pinned here:
 *
 *   day     → `deliveries.shift_date` when present, the Kuwait calendar day of
 *             `delivered_at` otherwise. One helper, `core/shift-day.ts`.
 *   count   → Payroll prints every completed order (`pending`, `under_review`,
 *             `verified`); Earnings pays on `verified` only. Both numbers come
 *             from `core/order-count.ts`, so neither can invent a third.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");

function sourceOf(...parts: string[]): string {
  return readFileSync(join(root, ...parts), "utf8");
}

const payroll = sourceOf("functions", "src", "rpcs", "payroll.ts");
const earnings = sourceOf("functions", "src", "rpcs", "earnings.ts");
const incentiveStore = sourceOf("functions", "src", "core", "incentive-store.ts");
const orderCount = sourceOf("functions", "src", "core", "order-count.ts");

test("Payroll reads all three completed counters", () => {
  // `under_review` was missing, so a day whose deliveries were all in review
  // read 0 orders in Payroll while the Deliveries list showed them.
  const start = payroll.indexOf("async function loadOrderCountsByDriverDay");
  assert.ok(start > 0, "loadOrderCountsByDriverDay is missing");
  const body = payroll.slice(start, start + 2200);
  for (const field of ["verified", "orders", "pending", "under_review"]) {
    assert.match(body, new RegExp(`"${field}"`), `the rollup select no longer reads ${field}`);
  }
  assert.match(
    body,
    /recordedOrdersOf\(/,
    "the cell no longer goes through the shared recorded-order rule",
  );
});

test("the two counters are never summed by mistake", () => {
  // `orders` and `verified` are two names for one counter; adding them would
  // double a rider's day.
  assert.match(
    orderCount,
    /export function verifiedOrdersOf[\s\S]*?Math\.max\(count\(row\.verified\), count\(row\.orders\)\)/,
    "verifiedOrdersOf no longer takes the maximum of the two aliases",
  );
  assert.match(
    orderCount,
    /export function recordedOrdersOf[\s\S]*?verifiedOrdersOf\(row\) \+ count\(row\.pending\) \+ count\(row\.under_review\)/,
    "recordedOrdersOf no longer adds exactly pending and under_review to verified",
  );
});

test("Earnings attributes a day by the booked shift", () => {
  // The regression: Earnings used the Kuwait calendar day of `delivered_at`, so
  // an order finished at 01:00 landed on the next day here and on the shift's
  // day in Payroll, Reconciliation and Performance.
  assert.match(
    earnings,
    /loadVerifiedDeliveriesForEarnDay/,
    "earnings.ts no longer reads the earn-day loader",
  );
  assert.ok(
    !/loadVerifiedDeliveriesForDeliveredDay\(/.test(earnings),
    "earnings.ts went back to the calendar-day loader",
  );
  assert.match(
    earnings,
    /loadVerifiedDriverIdsForEarnDay/,
    "the range sweep no longer finds riders by earn day",
  );
});

test("the earn-day loader filters on shift_date first", () => {
  const start = incentiveStore.indexOf("export async function loadVerifiedDeliveriesForEarnDay");
  assert.ok(start > 0, "loadVerifiedDeliveriesForEarnDay is missing");
  const body = incentiveStore.slice(start, start + 2000);
  assert.match(body, /where\("shift_date", "==", day\)/, "the shift_date branch is gone");
  assert.match(
    body,
    /where\("shift_date", "==", null\)[\s\S]*?where\("delivered_at", ">=", kuwaitDayStart\(day\)\)/,
    "the legacy fallback for rows written before shift_date existed is gone",
  );
});

test("Earnings stores both numbers, so no surface has to guess", () => {
  assert.match(
    earnings,
    /deliveries,\s*\n\s*recorded_deliveries:/,
    "the earnings row no longer stores the recorded count beside the paid one",
  );
  assert.match(
    earnings,
    /loadRecordedDeliveriesForEarnDay\(/,
    "the recorded count is no longer read from the same shift day",
  );
});

test("the recorded loader counts exactly the completed statuses", () => {
  const start = incentiveStore.indexOf("export async function loadRecordedDeliveriesForEarnDay");
  assert.ok(start > 0, "loadRecordedDeliveriesForEarnDay is missing");
  const body = incentiveStore.slice(start, start + 1800);
  assert.match(
    body,
    /where\("status", "in", \[\.\.\.RECORDED_ORDER_STATUSES\]\)/,
    "the recorded loader no longer uses the shared status vocabulary",
  );
  assert.ok(
    !/"in_transit"/.test(body),
    "in_transit is work in progress, not a completed order",
  );
});
