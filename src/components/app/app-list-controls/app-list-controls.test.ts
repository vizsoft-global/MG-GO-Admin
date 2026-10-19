import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupCounts, groupRows } from "./group-rows";
import { fieldSearchMatch, searchClearVisible } from "./search-match";

type Row = { name: string; zone: string | null; id: string };

const accessors = {
  name: (row: Row) => row.name,
  zone: (row: Row) => row.zone,
  id: (row: Row) => row.id,
};

const rows: Row[] = [
  { name: "Ali", zone: "Hawally", id: "108899" },
  { name: "Jenson", zone: "Hawally", id: "10088" },
  { name: "Omar", zone: null, id: "10001" },
];

describe("AppListControls helpers", () => {
  it("searches every field at once, token by token", () => {
    assert.equal(fieldSearchMatch(rows[0]!, "108899", accessors), true);
    assert.equal(fieldSearchMatch(rows[0]!, "ali", accessors), true);
    assert.equal(fieldSearchMatch(rows[0]!, "ali hawally", accessors), true);
    assert.equal(fieldSearchMatch(rows[0]!, "haw", accessors), true);
    assert.equal(fieldSearchMatch(rows[0]!, "Ali Hawally", accessors), true);
    assert.equal(fieldSearchMatch(rows[0]!, "jenson", accessors), false);
    assert.equal(fieldSearchMatch(rows[0]!, "1", accessors), true);
  });

  it("groups rows and counts unassigned last", () => {
    const grouped = groupRows(rows, "zone", accessors, { Hawally: "Hawally" }, "Unassigned");
    assert.equal(grouped[0]?.key, "Hawally");
    assert.equal(grouped[0]?.rows.length, 2);
    assert.equal(grouped[1]?.key, "unassigned");
    assert.deepEqual(groupCounts(rows, "zone", accessors), [
      { key: "Hawally", count: 2 },
      { key: "unassigned", count: 1 },
    ]);
  });

  it("shows the clear button exactly when the box has text", () => {
    assert.equal(searchClearVisible(""), false);
    assert.equal(searchClearVisible(undefined), false);
    assert.equal(searchClearVisible(null), false);
    assert.equal(searchClearVisible("ali"), true);
  });
});
