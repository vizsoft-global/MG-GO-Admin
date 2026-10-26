import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchesVisitListFilter, tallyVisitDays, type VisitListMatch } from "./visit-list-match";

const row: VisitListMatch = {
  status: "confirmed",
  department_key: "hr",
  branch_id: "central",
  driver_name: "Sara Ali",
  driver_code: "10043",
  booking_code: "VIS-1001",
  slot_start: "09:30:00",
};

describe("matchesVisitListFilter", () => {
  it("matches a driver by name or id and a slot by HH:mm", () => {
    assert.equal(matchesVisitListFilter(row, { driver: "sara" }), true);
    assert.equal(matchesVisitListFilter(row, { driver: "10043" }), true);
    assert.equal(matchesVisitListFilter(row, { driver: "99999" }), false);
    assert.equal(matchesVisitListFilter(row, { slot: "09:30" }), true);
    assert.equal(matchesVisitListFilter(row, { slot: "10:00" }), false);
    assert.equal(matchesVisitListFilter(row, { code: "1001", department: "hr", branch: "central" }), true);
  });
});

describe("tallyVisitDays", () => {
  it("drops cancelled rows and counts departments", () => {
    const days = tallyVisitDays([
      { scheduled_date: "2026-10-26", status: "confirmed", department_key: "hr", branch_id: "central" },
      { scheduled_date: "2026-10-26", status: "cancelled", department_key: "hr", branch_id: "central" },
      { scheduled_date: "2026-10-26", status: "checked_in", department_key: "legal", branch_id: "central" },
      { scheduled_date: "2026-10-27", status: "confirmed", department_key: "hr", branch_id: "other" },
    ], "central");
    assert.deepEqual(days, [
      { date: "2026-10-26", booked: 2, departments: { hr: 1, legal: 1 } },
    ]);
  });
});
