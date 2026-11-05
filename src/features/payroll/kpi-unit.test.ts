import assert from "node:assert/strict";
import test from "node:test";
import { computePayrollKpis } from "./payroll-formulas";
import {
  kpiFactsOfRow,
  kpiPredicate,
  type PayrollKpiKey,
  type PayrollKpiRow,
} from "./payroll-kpi-selection";

const KEYS: readonly PayrollKpiKey[] = [
  "active",
  "atOrAbove100",
  "unjustified",
  "reduced3Days",
  "manualAdjustments",
];

const ROWS: readonly PayrollKpiRow[] = [
  { status: "Active", efficiency: 104, unjustified: 0, days: [], adjusted: false },
  { status: "Active", efficiency: 100, unjustified: 0, days: [], adjusted: false },
  { status: "Active", efficiency: 99.9, unjustified: 0, days: [], adjusted: false },
  { status: "Inactive", efficiency: 1, unjustified: 2, days: ["reduced3"], adjusted: true },
  { status: "Active", efficiency: 0, unjustified: 0, days: ["reduced3", "reduced3"], adjusted: true },
  { status: "Inactive", efficiency: 87, unjustified: 0, days: [], adjusted: false },
];

function printed(key: PayrollKpiKey): number {
  const kpis = computePayrollKpis(
    ROWS.map((row) => ({
      status: row.status,
      efficiency: row.efficiency,
      unjustified: row.unjustified,
      reducedDays: row.days.includes("reduced3") ? row.days.length : 0,
      adjustedCells: row.adjusted ? 1 : 0,
    })),
  );
  switch (key) {
    case "active":
      return kpis.active;
    case "atOrAbove100":
      return kpis.atOrAbove100;
    case "unjustified":
      return kpis.unjustifiedRiders;
    case "reduced3Days":
      return kpis.reduced3Days;
    case "manualAdjustments":
      return kpis.manualAdjustments;
    default: {
      const never: never = key;
      return never;
    }
  }
}

test("every card prints exactly the rows its own predicate filters", () => {
  for (const key of KEYS) {
    const expected = ROWS.filter((row) => kpiPredicate(key)(kpiFactsOfRow(row))).length;
    assert.equal(printed(key), expected, `${key} disagrees with its table`);
  }
});

test("efficiency is a percent, so 1%-99% riders are not above 100%", () => {
  const matches = kpiPredicate("atOrAbove100");
  assert.equal(matches(kpiFactsOfRow(ROWS[0])), true, "104% qualifies");
  assert.equal(matches(kpiFactsOfRow(ROWS[1])), true, "100% qualifies");
  assert.equal(matches(kpiFactsOfRow(ROWS[2])), false, "99.9% does not");
  assert.equal(matches(kpiFactsOfRow(ROWS[3])), false, "1% does not — the reported bug");
  assert.equal(printed("atOrAbove100"), 2);
});

test("an empty sheet prints zero riders and no qualifying rows", () => {
  const kpis = computePayrollKpis([]);
  assert.equal(kpis.riders, 0);
  assert.equal(kpis.avgEfficiency, 0);
  for (const key of KEYS) {
    const matches = kpiPredicate(key);
    assert.equal(([] as PayrollKpiRow[]).filter((row) => matches(kpiFactsOfRow(row))).length, 0);
  }
});

test("selecting a card twice is the same as selecting none", () => {
  assert.equal(kpiPredicate(null)(kpiFactsOfRow(ROWS[0])), true);
  assert.equal(kpiPredicate(null)(kpiFactsOfRow(ROWS[3])), true);
});
