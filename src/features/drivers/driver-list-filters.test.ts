import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { driverListFilterCount, hasAnyDriverListFilter } from "./driver-list-filters";

/**
 * Clear filters is always visible, so its enabled state and its badge have to
 * agree with what is actually narrowing the table: the funnels, the search box,
 * the level chip, the tab and a `?project=` deep-link.
 */
describe("hasAnyDriverListFilter", () => {
  const clean = {
    columnFilterCount: 0,
    search: "",
    levelFilter: "all",
    tabFilter: "all",
    projectParam: null,
  };

  it("is false on a clean list", () => {
    assert.equal(hasAnyDriverListFilter(clean), false);
    assert.equal(driverListFilterCount(clean), 0);
  });

  it("sees every control that narrows the list", () => {
    assert.equal(hasAnyDriverListFilter({ ...clean, columnFilterCount: 2 }), true);
    assert.equal(hasAnyDriverListFilter({ ...clean, search: "ali" }), true);
    assert.equal(hasAnyDriverListFilter({ ...clean, levelFilter: "D" }), true);
    assert.equal(hasAnyDriverListFilter({ ...clean, tabFilter: "pending" }), true);
    assert.equal(hasAnyDriverListFilter({ ...clean, projectParam: "keeta" }), true);
  });

  it("ignores whitespace-only input", () => {
    assert.equal(hasAnyDriverListFilter({ ...clean, search: "   ", projectParam: "  " }), false);
    assert.equal(driverListFilterCount({ ...clean, search: "  " }), 0);
  });

  it("counts each control, with the funnels counted individually", () => {
    assert.equal(
      driverListFilterCount({
        columnFilterCount: 2,
        search: "ali",
        levelFilter: "D",
        tabFilter: "pending",
        projectParam: "keeta",
      }),
      6,
    );
  });
});
