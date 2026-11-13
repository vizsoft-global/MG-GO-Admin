import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { positiveRatio } from "./ops-kpi";

/**
 * The Performance UTR denominator.
 *
 * This pins the rule that broke the client's dashboard: 98 verified orders were
 * divided by 135,654 on-shift hours, because the numerator counted only riders
 * with a counted order while the denominator summed hours over the whole matched
 * fleet. The ratio is meaningless unless both sides describe the same riders.
 *
 * The arithmetic below mirrors `functions/src/rpcs/ops.ts` after the fix:
 *
 *     workingHours = Σ hoursByDriver[rider]   for rider in scopedRiders
 *     utr          = positiveRatio(orders, workingHours)
 *
 * where `scopedRiders` is exactly the rider set the numerator sums over.
 */
type Rider = { id: string; orders: number; hours: number };

function utrOf(riders: readonly Rider[], scopedIds: ReadonlySet<string>) {
  const scoped = riders.filter((r) => scopedIds.has(r.id));
  const orders = scoped.reduce((sum, r) => sum + r.orders, 0);
  const hours = scoped.reduce((sum, r) => sum + r.hours, 0);
  return { orders, hours, utr: positiveRatio(orders, hours) };
}

describe("performance UTR composition", () => {
  const fleet: Rider[] = [
    { id: "a", orders: 40, hours: 120 },
    { id: "b", orders: 58, hours: 100 },
    // Logged hours, completed nothing the order-status filter counts.
    { id: "c", orders: 0, hours: 120_000 },
    { id: "d", orders: 0, hours: 15_654 },
  ];

  it("counts only the riders the numerator counts", () => {
    const scoped = new Set(["a", "b"]);
    const { orders, hours, utr } = utrOf(fleet, scoped);
    assert.equal(orders, 98);
    // NOT 135,874 — the fleet-wide total that printed 135,654.3 in the report.
    assert.equal(hours, 220);
    assert.equal(utr, 98 / 220);
  });

  it("never divides by hours the numerator's riders did not work", () => {
    // Two riders with orders, two without; the without-hours must not reach the
    // denominator, or the ratio collapses toward zero.
    const onlyOne = utrOf(fleet, new Set(["a"]));
    assert.equal(onlyOne.hours, 120);
    assert.ok((onlyOne.utr ?? 0) > 0.3);
  });

  it("returns null rather than 0 when no counted rider worked any hours", () => {
    assert.equal(positiveRatio(0, 0), null);
    assert.equal(positiveRatio(5, 0), null);
  });

  it("keeps a rider's full shift hours when they do appear in the numerator", () => {
    // One order over a 12-hour shift contributes both sides — that is the honest
    // reading of "orders per shift hour", not a truncated hour count.
    const single = utrOf([{ id: "x", orders: 1, hours: 12 }], new Set(["x"]));
    assert.equal(single.utr, 1 / 12);
  });
});
