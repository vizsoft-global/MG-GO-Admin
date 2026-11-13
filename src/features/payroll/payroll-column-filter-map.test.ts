import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ColumnFilterDraft } from "@/components/app/column-filter";
import { draftToColumnFilter, draftToLiveFilter } from "./payroll-column-filter-map";
import { matchesColumnFilter } from "./payroll-column-filter-match";

function draft(overrides: Partial<ColumnFilterDraft> = {}): ColumnFilterDraft {
  return {
    mode: "list",
    text: "",
    query: "",
    picked: [],
    min: "",
    max: "",
    ...overrides,
  };
}

describe("payroll column funnel — Apply", () => {
  it("commits the text box, trimmed", () => {
    assert.deepEqual(draftToColumnFilter(draft({ mode: "text", text: "  Ali  " })), {
      kind: "text",
      text: "Ali",
    });
    assert.equal(draftToColumnFilter(draft({ mode: "text", text: "   " })), null);
  });

  it("commits the ticks, and a checklist search is not part of them", () => {
    assert.deepEqual(draftToColumnFilter(draft({ picked: ["A", "B"], query: "Am" })), {
      kind: "list",
      values: ["A", "B"],
    });
    assert.equal(draftToColumnFilter(draft({ query: "Am" })), null);
  });

  it("commits the bounds, and refuses a non-numeric one", () => {
    assert.deepEqual(draftToColumnFilter(draft({ mode: "range", min: "2", max: "10" })), {
      kind: "range",
      min: 2,
      max: 10,
    });
    assert.deepEqual(draftToColumnFilter(draft({ mode: "range", min: "x", max: "10" })), {
      kind: "range",
      min: null,
      max: 10,
    });
    assert.equal(draftToColumnFilter(draft({ mode: "range" })), null);
  });
});

describe("payroll column funnel — live typing", () => {
  it("turns a checklist search into a contains filter on that column", () => {
    assert.deepEqual(draftToLiveFilter(draft({ query: "Ama" })), { kind: "text", text: "Ama" });
  });

  it("behaves like Apply when no search is typed", () => {
    const ticks = draft({ picked: ["A"] });
    assert.deepEqual(draftToLiveFilter(ticks), draftToColumnFilter(ticks));
  });

  it("keeps Text and Range live", () => {
    assert.deepEqual(draftToLiveFilter(draft({ mode: "text", text: "Kh" })), {
      kind: "text",
      text: "Kh",
    });
    assert.deepEqual(draftToLiveFilter(draft({ mode: "range", min: "5" })), {
      kind: "range",
      min: 5,
      max: null,
    });
  });

  it("narrows the rows the same way the committed filter would", () => {
    const live = draftToLiveFilter(draft({ query: "aman" }));
    assert.equal(matchesColumnFilter("Amano Luea Jathin", live ?? undefined), true);
    assert.equal(matchesColumnFilter("Ahmed Fahed", live ?? undefined), false);
    // Case-insensitive, and a single letter is a real query.
    assert.equal(matchesColumnFilter("Amano Luea Jathin", { kind: "text", text: "a" }), true);
  });
});

describe("payroll column funnel — clearing", () => {
  it("restores the whole column from an empty draft of any mode", () => {
    assert.equal(draftToLiveFilter(draft({ mode: "text" })), null);
    assert.equal(draftToLiveFilter(draft({ mode: "list" })), null);
    assert.equal(draftToLiveFilter(draft({ mode: "range" })), null);
    // And an absent filter matches everything, which is what the clear does.
    assert.equal(matchesColumnFilter("anything", null), true);
  });
});
