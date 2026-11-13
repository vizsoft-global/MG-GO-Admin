import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allVisiblePicked,
  draftNarrows,
  filterColumnOptions,
  isPicked,
  matchingValues,
  toggleVisible,
  visibleOptionCount,
  type ColumnFilterDraft,
  type ColumnFilterOption,
} from "./index";

const options: ColumnFilterOption[] = [
  { value: "1", label: "Abdul Samad Haloon Gha", count: 1 },
  { value: "2", label: "Ahmed Fahed", count: 2 },
  { value: "3", label: "Amano Luea Jathin", count: 1 },
  { value: "4", label: "Aman Chowdhary", count: 1 },
  { value: "5", label: "Albert", count: 1 },
  { value: "CLI-270", label: "Americana - Salmiya", count: 3 },
];

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

describe("column filter checklist search", () => {
  it("shows every option with an empty query", () => {
    assert.equal(filterColumnOptions(options, "").length, options.length);
    assert.equal(filterColumnOptions(options, "   ").length, options.length);
  });

  it("narrows the checklist on a single character, case-insensitively", () => {
    const hits = filterColumnOptions(options, "a");
    // Every label here contains an "a"; the point is that one letter already
    // filters rather than waiting for three.
    assert.ok(hits.length >= 5);
    assert.deepEqual(
      filterColumnOptions(options, "AMAN").map((option) => option.value),
      ["3", "4"],
    );
  });

  it("matches a partial substring anywhere in the label", () => {
    assert.deepEqual(
      filterColumnOptions(options, "chowd").map((option) => option.value),
      ["4"],
    );
    assert.deepEqual(
      filterColumnOptions(options, "lm").map((option) => option.value),
      ["CLI-270"],
    );
  });

  it("matches the stored value as well as the printed label", () => {
    assert.deepEqual(
      filterColumnOptions(options, "270").map((option) => option.value),
      ["CLI-270"],
    );
  });

  it("returns nothing rather than everything when no option matches", () => {
    assert.deepEqual(filterColumnOptions(options, "zzz"), []);
  });

  it("recounts only what is visible", () => {
    assert.equal(visibleOptionCount(options), 9);
    assert.equal(visibleOptionCount(filterColumnOptions(options, "aman")), 2);
  });
});

describe("column filter checklist ticks", () => {
  const visible = filterColumnOptions(options, "aman");

  it("reports a value as picked only when it is in the draft", () => {
    assert.equal(isPicked(draft({ picked: ["3"] }), "3"), true);
    assert.equal(isPicked(draft({ picked: ["3"] }), "4"), false);
  });

  it("ticks the visible set and unticks it when it is already complete", () => {
    assert.equal(allVisiblePicked(draft(), visible), false);
    assert.deepEqual(toggleVisible(draft(), visible), ["3", "4"]);
    assert.equal(allVisiblePicked(draft({ picked: ["3", "4"] }), visible), true);
    assert.deepEqual(toggleVisible(draft({ picked: ["3", "4"] }), visible), []);
  });

  it("never calls an empty checklist complete", () => {
    assert.equal(allVisiblePicked(draft({ picked: ["1"] }), []), false);
  });
});

describe("draft narrowing", () => {
  it("is live for a text box with anything in it", () => {
    assert.equal(draftNarrows(draft({ mode: "text", text: "a" })), true);
    assert.equal(draftNarrows(draft({ mode: "text", text: "   " })), false);
  });

  it("is live for a checklist search or a tick", () => {
    assert.equal(draftNarrows(draft({ query: "n" })), true);
    assert.equal(draftNarrows(draft({ picked: ["1"] })), true);
    assert.equal(draftNarrows(draft()), false);
  });

  it("is live for either range bound", () => {
    assert.equal(draftNarrows(draft({ mode: "range", min: "1" })), true);
    assert.equal(draftNarrows(draft({ mode: "range", max: "9" })), true);
    assert.equal(draftNarrows(draft({ mode: "range" })), false);
  });
});

describe("value-list narrowing", () => {
  it("keeps the values a query matches, so the rows answer before Apply", () => {
    assert.deepEqual(matchingValues(["Keeta", "KFC", "Americana"], "k"), ["Keeta", "KFC"]);
    assert.deepEqual(matchingValues(["Keeta", "KFC"], "zzz"), []);
  });

  it("returns the whole list for an empty query", () => {
    assert.deepEqual(matchingValues(["a", "b"], ""), ["a", "b"]);
  });
});
