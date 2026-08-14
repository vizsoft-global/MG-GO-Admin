import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSearchSelectVisibleItems } from "./search-select-items";

const items = [
  { value: "all", label: "All Partners" },
  { value: "dd", label: "DoorDash" },
  { value: "ue", label: "Uber Eats" },
];

describe("buildSearchSelectVisibleItems", () => {
  it("keeps All Partners first even when Uber Eats is a recent pick", () => {
    const visible = buildSearchSelectVisibleItems({
      items,
      query: "",
      filteredItems: items,
      recents: ["ue"],
      recentsCount: 5,
      defaultLimit: 8,
    });
    assert.deepEqual(
      visible.map((item) => item.label),
      ["All Partners", "Uber Eats", "DoorDash"],
    );
  });

  it("does not let a recent All Partners selection bury the sentinel", () => {
    const visible = buildSearchSelectVisibleItems({
      items,
      query: "",
      filteredItems: items,
      recents: ["ue", "all"],
      recentsCount: 5,
      defaultLimit: 8,
    });
    assert.equal(visible[0]?.value, "all");
    assert.equal(visible[1]?.value, "ue");
  });
});
