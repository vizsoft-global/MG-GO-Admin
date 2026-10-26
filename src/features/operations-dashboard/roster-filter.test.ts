import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterRoster, normalizeOperationsDashboard, rosterMatches, type RosterRow } from "./shape";

const rows: RosterRow[] = [
  { employeeId: "1001", name: "Ada", project: "keeta", zone: "A", status: "working", joined: "2024-01-01", phone: "500" },
  { employeeId: "1002", name: "Bo", project: "keeta", zone: "A", status: "onLeave", joined: "", phone: "" },
  { employeeId: "1003", name: "Cy", project: "americana", zone: "", status: "absent", joined: "", phone: "" },
];

describe("See who roster", () => {
  it("keeps the people behind each card", () => {
    assert.equal(filterRoster(rows, "all", "").length, 3);
    assert.equal(filterRoster(rows, "working", "").length, 1);
    assert.equal(filterRoster(rows, "notWorking", "").length, 2);
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
});
