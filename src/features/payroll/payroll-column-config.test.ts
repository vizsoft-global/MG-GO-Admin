import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AO_HEADING_KEYS,
  APP_ATTENDANCE_HEADING_KEYS,
  COMBINED_HEADING_KEYS,
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

  it("ignores the old restaurant and partner defaults", () => {
    const stored = configByKey([
      { columnKey: "restaurant", label: "Client Name", hiddenViews: [] },
      { columnKey: "partner", label: "Partner", hiddenViews: [] },
      { columnKey: "name", label: "Rider name", hiddenViews: [] },
    ]);
    assert.equal(resolveColumnLabel("restaurant", "Restaurant", stored), "Restaurant");
    assert.equal(resolveColumnLabel("partner", "Client Name", stored), "Client Name");
    assert.equal(resolveColumnLabel("name", "Name", stored), "Rider name");
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

  it("offers the status heading on every view that renders it", () => {
    for (const keys of [COMBINED_HEADING_KEYS, AO_HEADING_KEYS, APP_ATTENDANCE_HEADING_KEYS]) {
      const list = keys as readonly string[];
      const index = list.indexOf("status");
      assert.notEqual(index, -1);
      assert.equal(list[index - 1], "vehicleKind");
    }
  });
});
