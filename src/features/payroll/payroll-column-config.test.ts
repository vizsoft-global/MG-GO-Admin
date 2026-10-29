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
    // Combined Payroll uses the SOP ids (`veh`), the other two keep `vehicleKind`.
    const previous: Record<string, string> = {
      combined: "veh",
      ao: "vehicleKind",
      app_attendance: "vehicleKind",
    };
    for (const [view, keys] of [
      ["combined", COMBINED_HEADING_KEYS],
      ["ao", AO_HEADING_KEYS],
      ["app_attendance", APP_ATTENDANCE_HEADING_KEYS],
    ] as const) {
      const list = keys as readonly string[];
      const index = list.indexOf("status");
      assert.notEqual(index, -1, view);
      assert.equal(list[index - 1], previous[view], view);
    }
  });

  it("offers the Combined-only SOP columns for renaming", () => {
    const list = COMBINED_HEADING_KEYS as readonly string[];
    for (const key of ["rest", "zcat", "proj", "req", "act", "eff", "wd", "lo"]) {
      assert.ok(list.includes(key), key);
    }
    // The day block is a date range, so it has no heading of its own.
    assert.ok(!list.includes("days"));
  });
});
