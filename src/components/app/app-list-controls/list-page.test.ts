import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LIST_PAGE_SIZE,
  buildGroupSections,
  pageRange,
  scopeSelectionState,
  toggleScopeSelection,
} from "./list-page";

function rows(count: number, prefix: string) {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}` }));
}

describe("buildGroupSections", () => {
  it("pages a flat list at 80 and selects every filtered row", () => {
    const built = buildGroupSections({
      groups: [{ key: "all", label: "", rows: rows(200, "d") }],
      grouped: false,
      openKeys: new Set(),
      groupPage: {},
      flatPage: 1,
    });
    assert.equal(built.sections[0]?.visibleRows.length, LIST_PAGE_SIZE);
    assert.equal(built.sections[0]?.visibleRows[0]?.id, "d-80");
    assert.equal(built.scopeRows.length, 200);
    assert.deepEqual(built.flatPager, { page: 1, total: 200 });
    assert.deepEqual(pageRange(1, 200), { from: 81, to: 160 });
  });

  it("keeps groups closed and scopes select-all to every page of opened groups", () => {
    const built = buildGroupSections({
      groups: [
        { key: "bike", label: "Bike", rows: rows(100, "b") },
        { key: "car", label: "Car", rows: rows(10, "c") },
      ],
      grouped: true,
      openKeys: new Set(["bike"]),
      groupPage: { bike: 1 },
      flatPage: 0,
    });
    const bike = built.sections[0];
    const car = built.sections[1];
    assert.equal(bike?.open, true);
    assert.equal(bike?.visibleRows.length, 20);
    assert.equal(bike?.visibleRows[0]?.id, "b-80");
    assert.equal(bike?.showPager, true);
    assert.equal(car?.open, false);
    assert.equal(car?.visibleRows.length, 0);
    assert.equal(built.scopeRows.length, 100);
    assert.equal(built.scopeRows[0]?.id, "b-0");
    assert.equal(built.flatPager, null);
  });

  it("toggles only the opened scope and leaves other selections", () => {
    const selected = new Set(["closed-1", "b-0"]);
    const scope = ["b-0", "b-1"];
    assert.equal(scopeSelectionState(selected, scope), "some");
    const filled = toggleScopeSelection(selected, scope);
    assert.equal(filled.has("b-0"), true);
    assert.equal(filled.has("b-1"), true);
    assert.equal(filled.has("closed-1"), true);
    assert.equal(scopeSelectionState(filled, scope), "all");
    const cleared = toggleScopeSelection(filled, scope);
    assert.equal(cleared.has("b-0"), false);
    assert.equal(cleared.has("b-1"), false);
    assert.equal(cleared.has("closed-1"), true);
  });
});
