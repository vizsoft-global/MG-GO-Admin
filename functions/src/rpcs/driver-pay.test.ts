import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultPayPlan, parsePayPlan, validatePayPlan } from "./driver-pay";

/** The exact snake_case document the panel writes to `app_settings.driver_pay_plan`. */
function storedPlan(): Record<string, unknown> {
  const plan = defaultPayPlan();
  return {
    base_kwd: plan.base_kwd,
    low_base_kwd: plan.low_base_kwd,
    threshold: plan.threshold,
    floor_kwd: plan.floor_kwd,
    bands: plan.bands.map((band) => ({ ...band })),
    penalty_bike: plan.penalty_bike,
    penalty_car: plan.penalty_car,
    invalid_ladder: [...plan.invalid_ladder],
  };
}

describe("validatePayPlan", () => {
  it("accepts the SOP default", () => {
    assert.equal(validatePayPlan(defaultPayPlan()), true);
  });

  it("refuses a first band that does not start at threshold + 1", () => {
    const bad = defaultPayPlan();
    bad.bands[0] = { from: 299, to: 400, rate: 0.26 };
    assert.equal(validatePayPlan(bad), false);
  });

  it("refuses a gap, an overlap and a closed final band", () => {
    const gap = defaultPayPlan();
    gap.bands[1] = { from: 402, to: 500, rate: 0.35 };
    assert.equal(validatePayPlan(gap), false);

    const overlap = defaultPayPlan();
    overlap.bands[1] = { from: 400, to: 500, rate: 0.35 };
    assert.equal(validatePayPlan(overlap), false);

    const closed = defaultPayPlan();
    closed.bands[3] = { from: 601, to: 900, rate: 0.45 };
    assert.equal(validatePayPlan(closed), false);
  });

  it("refuses a negative rate or a negative ladder step", () => {
    const rate = defaultPayPlan();
    rate.bands[2] = { from: 501, to: 600, rate: -1 };
    assert.equal(validatePayPlan(rate), false);

    const ladder = defaultPayPlan();
    ladder.invalid_ladder = [7, -1, 120];
    assert.equal(validatePayPlan(ladder), false);
  });
});

describe("parsePayPlan", () => {
  it("round-trips the stored document the panel writes", () => {
    assert.deepEqual(parsePayPlan(storedPlan()), defaultPayPlan());
  });

  it("keeps the open final band as null and a closed end as a number", () => {
    const stored = storedPlan();
    const bands = stored.bands as Array<Record<string, unknown>>;
    bands[3] = { ...bands[3], to: null };
    const parsed = parsePayPlan(stored);
    assert.equal(parsed.bands[3]?.to, null);
    assert.equal(parsed.bands[2]?.to, 600);
  });

  it("reads a band whose end is missing from the seed", () => {
    const stored = storedPlan();
    const bands = stored.bands as Array<Record<string, unknown>>;
    delete bands[2]!.to;
    assert.equal(parsePayPlan(stored).bands[2]?.to, defaultPayPlan().bands[2]?.to);
  });

  it("falls back to the SOP default for junk", () => {
    assert.deepEqual(parsePayPlan(null), defaultPayPlan());
    assert.deepEqual(parsePayPlan(undefined), defaultPayPlan());
    assert.deepEqual(parsePayPlan("nope"), defaultPayPlan());
    assert.deepEqual(parsePayPlan({}), defaultPayPlan());
  });

  it("falls back when the stored bands cannot pass validation", () => {
    const stored = storedPlan();
    const bands = stored.bands as Array<Record<string, unknown>>;
    bands[1] = { ...bands[1], from: 999 };
    assert.deepEqual(parsePayPlan(stored), defaultPayPlan());
  });

  it("reads a plan stored under the legacy camelCase invalidLadder", () => {
    const { invalid_ladder: _dropped, ...rest } = storedPlan();
    const parsed = parsePayPlan({ ...rest, invalidLadder: [13, 39, 220] });
    assert.deepEqual(parsed.invalid_ladder, [13, 39, 220]);
  });

  it("prefers invalid_ladder when both spellings are present", () => {
    const stored = storedPlan();
    const parsed = parsePayPlan({ ...stored, invalidLadder: [13, 39, 220] });
    assert.deepEqual(parsed.invalid_ladder, [7, 21, 120]);
  });

  it("ignores an unknown ladder key rather than half-reading it", () => {
    const { invalid_ladder: _dropped, ...rest } = storedPlan();
    const parsed = parsePayPlan({ ...rest, invalid_days_ladder: [13, 39, 220] });
    assert.deepEqual(parsed.invalid_ladder, defaultPayPlan().invalid_ladder);
  });

  it("keeps a partial ladder on the stored steps and only defaults the blanks", () => {
    const stored = storedPlan();
    stored.invalid_ladder = [5, null, 200];
    assert.deepEqual(parsePayPlan(stored).invalid_ladder, [5, 21, 200]);
  });
});
