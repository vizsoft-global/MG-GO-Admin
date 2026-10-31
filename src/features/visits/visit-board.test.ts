import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tallyVisitDays } from "../../../functions/src/rpcs/visit-list-match";
import {
  addDaysYmd,
  aggregateVisitDays,
  countActiveBookings,
  kpiListQuery,
  monthMatrix,
  sumDepartmentCounts,
  visitHeat,
} from "./visit-board";

describe("kpiListQuery", () => {
  const today = "2026-10-26";

  it("uses the server windows", () => {
    assert.deepEqual(kpiListQuery("today", today), {
      dateFrom: today,
      dateTo: today,
      status: null,
    });
    assert.deepEqual(kpiListQuery("upcoming", today), {
      dateFrom: "2026-10-27",
      dateTo: "2026-11-02",
      status: "confirmed",
    });
    assert.deepEqual(kpiListQuery("awaiting", today), {
      dateFrom: today,
      dateTo: today,
      status: "confirmed",
    });
    assert.deepEqual(kpiListQuery("no_shows", today), {
      dateFrom: "2026-10-19",
      dateTo: null,
      status: "no_show",
    });
  });
});

describe("visitHeat", () => {
  it("paints open, high, and full from booked against capacity", () => {
    assert.equal(visitHeat(0, 10), "open");
    assert.equal(visitHeat(6, 10), "open");
    assert.equal(visitHeat(7, 10), "high");
    assert.equal(visitHeat(10, 10), "full");
    assert.equal(visitHeat(0, 0), "idle");
    assert.equal(visitHeat(2, 0), "full");
  });
});

describe("monthMatrix", () => {
  it("starts on Sunday and covers October 2026", () => {
    const cells = monthMatrix(2026, 9);
    assert.equal(cells[0], null);
    assert.equal(cells[4], 1);
    assert.equal(cells.filter((day) => day != null).length, 31);
    assert.equal(cells.length % 7, 0);
  });
});

describe("aggregateVisitDays", () => {
  it("skips cancelled bookings", () => {
    assert.deepEqual(
      aggregateVisitDays([
        { scheduled_date: "2026-10-26", status: "confirmed", department_key: "hr" },
        { scheduled_date: "2026-10-26", status: "cancelled", department_key: "hr" },
      ]),
      [{ date: "2026-10-26", booked: 1, departments: { hr: 1 } }],
    );
  });
});

describe("countActiveBookings", () => {
  it("skips cancelled and matches the department tally", () => {
    const rows = [
      { scheduled_date: "2026-10-26", status: "cancelled", department_key: "hr", branch_id: "hq" },
      { scheduled_date: "2026-10-26", status: "confirmed", department_key: "hr", branch_id: "hq" },
      { scheduled_date: "2026-10-26", status: "confirmed", department_key: "hr", branch_id: "hq" },
    ];
    assert.equal(countActiveBookings(rows), 2);
    const [day] = aggregateVisitDays(rows);
    assert.equal(day?.booked, 2);
    assert.equal(sumDepartmentCounts(day?.departments ?? {}), day?.booked);
    const [tallied] = tallyVisitDays(rows);
    assert.equal(tallied?.booked, 2);
    assert.equal(sumDepartmentCounts(tallied?.departments ?? {}), tallied?.booked);
  });
});

describe("addDaysYmd", () => {
  it("crosses a month boundary", () => {
    assert.equal(addDaysYmd("2026-10-26", 7), "2026-11-02");
  });
});
