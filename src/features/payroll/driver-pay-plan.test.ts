import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_DRIVER_PAY_PLAN,
  computeDriverPay,
  invalidDayPenalty,
  money3,
  ordersInBand,
  parseDriverPayPlan,
  payPlanToFirestore,
  validatePayPlan,
  type DriverPayPlan,
  type PayInput,
} from "./driver-pay-plan";

const plan = DEFAULT_DRIVER_PAY_PLAN;

function input(partial: Partial<PayInput>): PayInput {
  return {
    orders: 0,
    vehicle: "bike",
    rejected: 0,
    cancelled: 0,
    invalidDays: 0,
    ...partial,
  };
}

/* Reference sheet: 470 valid orders, Bike, 2 rejected, 0 invalid -> 166.500 */
describe("computeDriverPay - reference sheet", () => {
  it("pays 166.500 for 470 orders on a bike with 2 rejected", () => {
    const result = computeDriverPay(plan, input({ orders: 470, rejected: 2 }));
    assert.equal(result.finalPay, 166.5);
    assert.equal(result.base, 120);
    assert.equal(result.gross, 170.5);
    assert.equal(result.orderPenalty, 4);
    assert.equal(result.invalidPenalty, 0);
    assert.deepEqual(result.warnings, []);
  });

  it("breaks the pay into the published bands", () => {
    const result = computeDriverPay(plan, input({ orders: 470 }));
    const [first, second, third, fourth] = result.bands;
    assert.equal(first?.orders, 100);
    assert.equal(first?.amount, 26);
    assert.equal(second?.orders, 70);
    assert.equal(second?.amount, 24.5);
    assert.equal(third?.orders, 0);
    assert.equal(third?.amount, 0);
    assert.equal(fourth?.orders, 0);
    assert.equal(fourth?.amount, 0);
  });

  it("charges 3 per rejected order on a car", () => {
    const result = computeDriverPay(plan, input({ orders: 470, vehicle: "car", rejected: 2 }));
    assert.equal(result.orderPenalty, 6);
    assert.equal(result.finalPay, 164.5);
  });

  it("counts cancelled orders with rejected orders", () => {
    const result = computeDriverPay(plan, input({ orders: 470, rejected: 1, cancelled: 1 }));
    assert.equal(result.orderPenalty, 4);
    assert.equal(result.finalPay, 166.5);
  });
});

describe("computeDriverPay - band edges", () => {
  const cases: Array<[number, number]> = [
    [299, 90],
    [300, 120],
    [301, 120.26],
    [400, 146],
    [401, 146.35],
    [500, 181],
    [501, 181.4],
    [600, 221],
    [601, 221.45],
  ];

  for (const [orders, expected] of cases) {
    it(`pays ${expected} at ${orders} orders`, () => {
      assert.equal(computeDriverPay(plan, input({ orders })).finalPay, expected);
    });
  }
});

describe("computeDriverPay - low performance", () => {
  it("pays the low base and no bands under 300", () => {
    const result = computeDriverPay(plan, input({ orders: 250 }));
    assert.equal(result.base, 90);
    assert.equal(result.bands.every((band) => band.orders === 0), true);
    assert.equal(result.finalPay, 90);
    assert.equal(result.lowPerformance, true);
    assert.deepEqual(result.warnings, ["low_performance"]);
  });

  it("warns about next month when a low performer has invalid days", () => {
    const result = computeDriverPay(plan, input({ orders: 250, invalidDays: 1 }));
    assert.equal(result.warnings.includes("low_performance"), true);
    assert.equal(result.warnings.includes("termination_next_month"), true);
  });
});

describe("computeDriverPay - invalid days", () => {
  it("counts 7 / 21 / 120", () => {
    assert.equal(invalidDayPenalty(1, plan.invalidLadder), 7);
    assert.equal(invalidDayPenalty(2, plan.invalidLadder), 21);
    assert.equal(invalidDayPenalty(3, plan.invalidLadder), 120);
    assert.equal(invalidDayPenalty(9, plan.invalidLadder), 120);
    assert.equal(invalidDayPenalty(0, plan.invalidLadder), 0);
  });

  it("deducts 120 for three invalid days without emptying the month", () => {
    const result = computeDriverPay(plan, input({ orders: 300, invalidDays: 3 }));
    assert.equal(result.invalidPenalty, 120);
    assert.equal(result.finalPay, 90);
    assert.equal(result.penaltyRequested, 120);
    assert.equal(result.penaltyTaken, 30);
    assert.equal(result.penaltyNotTaken, 90);
    assert.equal(result.warnings.includes("floor"), true);
  });
});

describe("computeDriverPay - floor", () => {
  it("never pays below the floor", () => {
    const result = computeDriverPay(plan, input({ orders: 320, rejected: 60 }));
    assert.equal(result.finalPay, 90);
    assert.equal(result.penaltyNotTaken > 0, true);
    assert.equal(result.warnings.includes("floor"), true);
  });

  it("reports the orders needed for the next band", () => {
    const result = computeDriverPay(plan, input({ orders: 470 }));
    assert.equal(result.nextBandFrom, 501);
    assert.equal(result.ordersToNext, 31);
    assert.equal(computeDriverPay(plan, input({ orders: 700 })).ordersToNext, null);
  });
});

describe("helpers", () => {
  it("counts only the orders inside a closed band", () => {
    assert.equal(ordersInBand(470, 301, 400), 100);
    assert.equal(ordersInBand(470, 401, 500), 70);
    assert.equal(ordersInBand(470, 501, 600), 0);
    assert.equal(ordersInBand(700, 601, null), 100);
    assert.equal(ordersInBand(299, 301, 400), 0);
  });

  it("rounds to three decimals", () => {
    assert.equal(money3(1.0005), 1.001);
    assert.equal(money3(0.1 + 0.2), 0.3);
  });
});

describe("validatePayPlan", () => {
  const clone = (): DriverPayPlan => ({
    ...plan,
    bands: plan.bands.map((band) => ({ ...band })),
    invalidLadder: [...plan.invalidLadder],
  });

  it("accepts the default plan", () => {
    assert.equal(validatePayPlan(plan), null);
  });

  it("refuses a band that does not start after the threshold", () => {
    const bad = clone();
    bad.bands[0] = { from: 299, to: 400, rate: 0.26 };
    assert.notEqual(validatePayPlan(bad), null);
  });

  it("refuses a gap between bands", () => {
    const bad = clone();
    bad.bands[1] = { from: 402, to: 500, rate: 0.35 };
    assert.notEqual(validatePayPlan(bad), null);
  });

  it("refuses an overlapping pair", () => {
    const bad = clone();
    bad.bands[1] = { from: 400, to: 500, rate: 0.35 };
    assert.notEqual(validatePayPlan(bad), null);
  });

  it("refuses a closed final band", () => {
    const bad = clone();
    bad.bands[3] = { from: 601, to: 900, rate: 0.45 };
    assert.notEqual(validatePayPlan(bad), null);
  });

  it("refuses a negative rate", () => {
    const bad = clone();
    bad.bands[2] = { from: 501, to: 600, rate: -1 };
    assert.notEqual(validatePayPlan(bad), null);
  });
});

describe("parseDriverPayPlan", () => {
  it("round-trips a stored plan", () => {
    const stored = payPlanToFirestore(plan);
    assert.deepEqual(parseDriverPayPlan(stored), plan);
  });

  it("keeps the open final band as null and a closed end as a number", () => {
    const stored = payPlanToFirestore(plan) as { bands: Array<Record<string, unknown>> };
    stored.bands[3]!.to = null;
    const parsed = parseDriverPayPlan(stored);
    assert.equal(parsed.bands[3]?.to, null);
    assert.equal(parsed.bands[2]?.to, 600);
  });

  it("reads a band whose end is missing from the seed", () => {
    const stored = payPlanToFirestore(plan) as { bands: Array<Record<string, unknown>> };
    delete stored.bands[2]!.to;
    const parsed = parseDriverPayPlan(stored);
    assert.equal(parsed.bands[2]?.to, plan.bands[2]!.to);
  });

  it("falls back to the default for junk", () => {
    assert.deepEqual(parseDriverPayPlan(null), plan);
    assert.deepEqual(parseDriverPayPlan("nope"), plan);
    assert.deepEqual(parseDriverPayPlan({}), plan);
  });

  it("falls back when the stored plan cannot pass validation", () => {
    const stored = payPlanToFirestore(plan) as { bands: Array<Record<string, unknown>> };
    stored.bands[1]!.from = 999;
    assert.deepEqual(parseDriverPayPlan(stored), plan);
  });
});
