import assert from "node:assert/strict";
import { test } from "node:test";

import { computeIncentivePreview, incentiveBandStart } from "./types";

type Rule = Parameters<typeof computeIncentivePreview>[0];

const tier = (threshold: number, rate: number, index: number) => ({
  id: `t${index}`,
  threshold_deliveries: threshold,
  reward_mode: "per_delivery" as const,
  reward_kwd: null,
  reward_per_delivery_kwd: rate,
  sort_order: index,
});

const sopRule: Rule = {
  target_mode: "tiered",
  base_minimum_deliveries: 0,
  target_deliveries: null,
  reward_mode: "fixed",
  reward_kwd: 0,
  reward_per_delivery_kwd: null,
  payout_mode: "milestone",
  tiers: [tier(15, 0.25, 0), tier(20, 0.35, 1), tier(25, 0.4, 2)],
};

const kwd = (n: number) => Math.round(n * 1000) / 1000;

test("SOP examples pay per order above the daily target", () => {
  const start = incentiveBandStart(sopRule, 10);
  assert.equal(start, 10);
  const cases: [number, number][] = [
    [0, 0],
    [9, 0],
    [10, 0],
    [13, 0.75],
    [15, 1.25],
    [18, 2.3],
    [22, 3.8],
    [25, 5],
    [30, 5],
  ];
  for (const [count, expected] of cases) {
    assert.equal(kwd(computeIncentivePreview(sopRule, count, start)), expected, `count ${count}`);
  }
});

test("band start falls back like SQL when the target is unknown or too high", () => {
  assert.equal(incentiveBandStart(sopRule), 10);
  assert.equal(incentiveBandStart(sopRule, 15), 10);
  assert.equal(incentiveBandStart({ ...sopRule, base_minimum_deliveries: 12 }), 12);
});

test("fixed tiers and single-target rules keep the legacy math", () => {
  const fixed: Rule = {
    ...sopRule,
    tiers: [
      { ...tier(2, 0, 0), reward_mode: "fixed", reward_kwd: 5, reward_per_delivery_kwd: null },
      { ...tier(4, 0, 1), reward_mode: "fixed", reward_kwd: 10, reward_per_delivery_kwd: null },
    ],
  };
  assert.equal(incentiveBandStart(fixed, 1), null);
  assert.equal(computeIncentivePreview(fixed, 4, null), 15);

  const single: Rule = {
    ...sopRule,
    target_mode: "single",
    target_deliveries: 10,
    reward_mode: "fixed",
    reward_kwd: 3,
    tiers: [],
  };
  assert.equal(incentiveBandStart(single, 5), null);
  assert.equal(computeIncentivePreview(single, 10, null), 3);
  assert.equal(computeIncentivePreview(single, 9, null), 0);
});

test("legacy stacked tiers are unchanged without a band start", () => {
  assert.equal(kwd(computeIncentivePreview(sopRule, 25, null)), kwd(15 * 0.25 + 20 * 0.35 + 25 * 0.4));
});
