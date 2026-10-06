import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AO_HEADING_KEYS,
  columnHiddenIn,
  configByKey,
  hiddenSetFor,
  resolveColumnLabel,
} from "./payroll-column-config";

describe("payroll column config", () => {
  const config = configByKey([
    { columnKey: "amId", label: "AM", hiddenViews: ["combined"] },
    { columnKey: "name", label: " Rider ", hiddenViews: [] },
  ]);

  it("uses the trimmed custom label and falls back otherwise", () => {
    assert.equal(resolveColumnLabel("amId", "AM ID", config), "AM");
    assert.equal(resolveColumnLabel("name", "Name", config), "Rider");
    assert.equal(resolveColumnLabel("zone", "Zone", config), "Zone");
  });

  it("hides a heading only in the views that were saved", () => {
    assert.equal(columnHiddenIn("amId", "combined", config), true);
    assert.equal(columnHiddenIn("amId", "ao", config), false);
    assert.deepEqual([...hiddenSetFor("combined", config)], ["amId"]);
    assert.deepEqual([...hiddenSetFor("ao", config)], []);
  });

  it("keeps restaurant identity on Attendance & Orders headings", () => {
    assert.deepEqual([...AO_HEADING_KEYS].slice(0, 5), [
      "amId",
      "mgId",
      "name",
      "restaurant",
      "restaurantId",
    ]);
  });
});
