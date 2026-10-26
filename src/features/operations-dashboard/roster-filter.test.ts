import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterRoster, normalizeOperationsDashboard, periodBounds, rosterMatches, type RosterRow } from "./shape";

const rows: RosterRow[] = [
  { employeeId: "1001", name: "Ada", project: "keeta", zone: "A", status: "working", statuses: [], joined: "2024-01-01", phone: "500" },
  { employeeId: "1002", name: "Bo", project: "keeta", zone: "A", status: "onLeave", statuses: [], joined: "", phone: "" },
  { employeeId: "1003", name: "Cy", project: "americana", zone: "", status: "absent", statuses: ["absent", "working"], joined: "", phone: "" },
];

describe("See who roster", () => {
  it("keeps the people behind each card", () => {
    assert.equal(filterRoster(rows, "all", "").length, 3);
    assert.equal(filterRoster(rows, "working", "").length, 2);
    assert.equal(filterRoster(rows, "notWorking", "").length, 2);
    assert.equal(filterRoster(rows, "working", "1003").length, 1);
    assert.equal(filterRoster(rows, "absent", "1003").length, 1);
    assert.equal(filterRoster(rows, "onLeave", "bo").length, 1);
    assert.equal(filterRoster(rows, "all", "1003")[0]?.name, "Cy");
    assert.equal(rosterMatches("working", "notWorking"), false);
    assert.equal(rosterMatches("sick", "sick"), true);
  });

  it("drops a status the table cannot show", () => {
    const dash = normalizeOperationsDashboard({
      roster: [...rows, { employeeId: "9", name: "No", status: "nope" }],
    });
    assert.equal(dash.roster.length, 3);
    assert.equal(dash.roster[1]?.status, "onLeave");
  });

  it("keeps a period inside today and thirty days", () => {
    assert.deepEqual(periodBounds("today", "2026-10-26", "", ""), { from: "2026-10-26", to: "2026-10-26" });
    assert.deepEqual(periodBounds("thisWeek", "2026-10-26", "", ""), { from: "2026-10-24", to: "2026-10-26" });
    assert.deepEqual(periodBounds("last7", "2026-10-26", "", ""), { from: "2026-10-20", to: "2026-10-26" });
    assert.deepEqual(periodBounds("lastMonth", "2026-10-26", "", ""), { from: "2026-09-01", to: "2026-09-30" });
    assert.deepEqual(periodBounds("custom", "2026-10-26", "2026-01-01", "2026-12-01"), { from: "2026-09-26", to: "2026-10-26" });
  });
});
