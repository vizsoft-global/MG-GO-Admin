import assert from "node:assert/strict";
import test from "node:test";
import { isZeroMetricValue } from "./kpi-zero";

test("zero counts are empty widgets", () => {
  assert.equal(isZeroMetricValue(0), true);
  assert.equal(isZeroMetricValue("0"), true);
  assert.equal(isZeroMetricValue("0.00"), true);
  assert.equal(isZeroMetricValue(" 0 "), true);
});

test("non-zero counts stay regular cards", () => {
  assert.equal(isZeroMetricValue(1), false);
  assert.equal(isZeroMetricValue("24"), false);
  assert.equal(isZeroMetricValue("0.5"), false);
});

test("percentages and loaders are measurements, not empty lists", () => {
  assert.equal(isZeroMetricValue("0.0%"), false);
  assert.equal(isZeroMetricValue("…"), false);
  assert.equal(isZeroMetricValue(""), false);
});
