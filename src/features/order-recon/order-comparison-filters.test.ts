import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyPageFilters, applySearch, applyComparisonFilters } from "./order-comparison-filters";
import { comparisonResult, type ComparisonRider } from "./order-comparison-model";

function rider(partial: Partial<ComparisonRider> & Pick<ComparisonRider, "mgId">): ComparisonRider {
  const am = partial.am ?? 0;
  const mggo = partial.mggo ?? 0;
  return {
    name: partial.name ?? "N",
    restaurant: partial.restaurant ?? "—",
    am,
    mggo,
    amDays: partial.amDays ?? [am],
    mggoDays: partial.mggoDays ?? [mggo],
    diffDays: partial.diffDays ?? [am - mggo],
    diff: partial.diff ?? am - mggo,
    diffPct: am === 0 ? null : (am - mggo) / am,
    offDays: partial.offDays ?? (am === mggo ? 0 : 1),
    workedDays: partial.workedDays ?? 1,
    result: partial.result ?? comparisonResult(am, mggo),
    ...partial,
  };
}

describe("order-comparison-filters", () => {
  const rows = [
    rider({ mgId: "1001", name: "Ada", restaurant: "Tower", am: 10, mggo: 10 }),
    rider({ mgId: "2002", name: "Bea", restaurant: "Mall", am: 12, mggo: 4, offDays: 3 }),
    rider({ mgId: "3003", name: "Cara", restaurant: "Tower", am: 8, mggo: 0 }),
  ];

  it("AND-combines search, result card, selected day and column filters", () => {
    const filtered = applyPageFilters(rows, {
      search: "a",
      result: "am_higher",
      dayIndex: 0,
      columns: { restaurant: ["Mall"] },
    });
    assert.deepEqual(
      filtered.map((r) => r.mgId),
      ["2002"],
    );
  });

  it("supports text contains and numeric min/max without treating text as a range", () => {
    const byId = applyComparisonFilters(rows, { mgId: { contains: "00" } });
    assert.equal(byId.length, 3);
    const byName = applyComparisonFilters(rows, { name: { contains: "be" } });
    assert.deepEqual(
      byName.map((r) => r.mgId),
      ["2002"],
    );
    const byRange = applyComparisonFilters(rows, { am: { min: 10, max: 11 } });
    assert.deepEqual(
      byRange.map((r) => r.mgId),
      ["1001"],
    );
  });

  it("search matches MG ID, name or restaurant", () => {
    assert.equal(applySearch(rows, "mall").length, 1);
    assert.equal(applySearch(rows, "3003").length, 1);
    assert.equal(applySearch(rows, "zzz").length, 0);
  });
});
