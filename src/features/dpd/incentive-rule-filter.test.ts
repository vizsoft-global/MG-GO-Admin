import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterIncentiveRules,
  isIncentiveRulePeriodFilter,
  isIncentiveRuleStatusFilter,
  type IncentiveRuleFilterable,
  type IncentiveRuleListFilter,
} from "./incentive-rule-filter";

function row(
  partial: Partial<IncentiveRuleFilterable> & Pick<IncentiveRuleFilterable, "name">,
): IncentiveRuleFilterable {
  return {
    scope_label: "Talabat · HQ",
    status: "active",
    period: "daily",
    ...partial,
  };
}

const rows: IncentiveRuleFilterable[] = [
  row({ name: "September HQ", scope_label: "Talabat · HQ", status: "active", period: "daily" }),
  row({ name: "Weekend bonus", scope_label: "Zone · Hawally", status: "draft", period: "weekly" }),
  row({ name: "Month closer", scope_label: "Partner · Careem", status: "ended", period: "monthly" }),
];

const open: IncentiveRuleListFilter = { query: "", status: "all", period: "all" };

test("open filters return every row", () => {
  assert.deepEqual(filterIncentiveRules(rows, open), rows);
});

test("query matches name case-insensitively and collapsed spaces", () => {
  assert.deepEqual(
    filterIncentiveRules(rows, { ...open, query: "  WEEKEND   BONUS " }).map((r) => r.name),
    ["Weekend bonus"],
  );
});

test("query matches restaurant or scope label", () => {
  assert.deepEqual(
    filterIncentiveRules(rows, { ...open, query: "careem" }).map((r) => r.name),
    ["Month closer"],
  );
  assert.deepEqual(
    filterIncentiveRules(rows, { ...open, query: "hawally" }).map((r) => r.name),
    ["Weekend bonus"],
  );
});

test("status and period narrow independently", () => {
  assert.deepEqual(
    filterIncentiveRules(rows, { ...open, status: "draft" }).map((r) => r.name),
    ["Weekend bonus"],
  );
  assert.deepEqual(
    filterIncentiveRules(rows, { ...open, period: "monthly" }).map((r) => r.name),
    ["Month closer"],
  );
});

test("combined filters can yield an empty list", () => {
  assert.deepEqual(
    filterIncentiveRules(rows, { query: "hq", status: "ended", period: "all" }),
    [],
  );
});

test("status and period guards accept only known values", () => {
  assert.equal(isIncentiveRuleStatusFilter("all"), true);
  assert.equal(isIncentiveRuleStatusFilter("active"), true);
  assert.equal(isIncentiveRuleStatusFilter("paused"), false);
  assert.equal(isIncentiveRulePeriodFilter("weekly"), true);
  assert.equal(isIncentiveRulePeriodFilter("yearly"), false);
});
