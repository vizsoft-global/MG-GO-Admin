import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  daysLeft,
  jobEndWindow,
  mapRequestLeave,
  mergeLeaveRows,
  monthCountsLeave,
  renewalDecision,
  turnoverComparison,
  turnoverRate,
} from "./operations-dashboard-math";

const TODAY = "2026-10";

describe("monthCountsLeave", () => {
  it("counts only approved leave in a future month", () => {
    for (const yearMonth of ["2026-11", "2026-12"]) {
      assert.equal(monthCountsLeave("approved", yearMonth, TODAY, true), true);
      assert.equal(monthCountsLeave("pending", yearMonth, TODAY, true), false);
      assert.equal(monthCountsLeave("taken", yearMonth, TODAY, true), false);
      assert.equal(monthCountsLeave("rejected", yearMonth, TODAY, true), false);
    }
  });

  it("counts pending leave in the current month", () => {
    assert.equal(monthCountsLeave("pending", TODAY, TODAY, false), true);
    assert.equal(monthCountsLeave("approved", TODAY, TODAY, false), true);
    assert.equal(monthCountsLeave("taken", TODAY, TODAY, false), true);
    assert.equal(monthCountsLeave("rejected", TODAY, TODAY, true), false);
  });

  it("counts taken and approved leave in a past month, and pending only when it covers today", () => {
    assert.equal(monthCountsLeave("taken", "2026-09", TODAY, false), true);
    assert.equal(monthCountsLeave("approved", "2026-09", TODAY, false), true);
    assert.equal(monthCountsLeave("pending", "2026-09", TODAY, false), false);
    assert.equal(monthCountsLeave("pending", "2026-09", TODAY, true), true);
    assert.equal(monthCountsLeave("rejected", "2026-09", TODAY, true), false);
  });
});

describe("turnoverRate", () => {
  it("is zero when the average active headcount is zero", () => {
    assert.equal(turnoverRate(3, 0), 0);
    assert.equal(turnoverRate(1, 4), 25);
  });
});

describe("renewalDecision", () => {
  it("returns no_renewal when a job end date has a blank description", () => {
    assert.equal(renewalDecision("", "2026-12-01"), "no_renewal");
    assert.equal(renewalDecision("   ", "2026-12-01"), "no_renewal");
    assert.equal(renewalDecision("end_of_contract", null), "end_of_contract");
    assert.equal(renewalDecision("", ""), null);
    assert.equal(renewalDecision(null, null), null);
  });
});

describe("jobEndWindow", () => {
  it("is six months starting at the current Kuwait month", () => {
    const window = jobEndWindow("2026-10-23");
    assert.equal(window.length, 6);
    assert.deepEqual(window[0], { key: "2026-10", label: "Oct (rest)" });
    assert.deepEqual(window[1], { key: "2026-11", label: "Nov" });
    assert.deepEqual(window[3], { key: "2027-01", label: "Jan 2027" });
    assert.deepEqual(window[5], { key: "2027-03", label: "Mar 2027" });
  });
});

describe("daysLeft", () => {
  it("counts whole days and is negative once the date has passed", () => {
    assert.equal(daysLeft("2026-10-23", "2026-10-23"), 0);
    assert.equal(daysLeft("2026-10-23", "2026-10-26"), 3);
    assert.equal(daysLeft("2026-10-23", "2026-10-20"), -3);
  });
});

describe("turnoverComparison", () => {
  it("builds twelve months, the annual rate, and the peak month", () => {
    const result = turnoverComparison(
      [
        { date: "2026-01-04" },
        { date: "2026-01-18" },
        { date: "2026-06-02" },
      ],
      10,
      "2026-10-23",
    );
    assert.equal(result.months.length, 12);
    assert.equal(result.months[0]?.departures, 2);
    assert.equal(result.months[5]?.departures, 1);
    assert.equal(result.departuresCount, 3);
    assert.equal(result.peakMonth, "Jan");
    assert.equal(result.annualPct, turnoverRate(3, 10 + 1.5));
    assert.ok(result.monthlyAvgPct > 0);
  });
});

describe("mapRequestLeave", () => {
  const base = {
    id: "abc",
    requestType: "leave",
    status: "submitted",
    driverId: "driver-1",
    employeeId: "10001",
    name: "Ada",
    project: "keeta",
    start: "2026-10-20",
    end: "2026-10-22",
    today: "2026-10-23",
    leaveTypeRaw: "Annual",
  };

  it("maps an open EmployeeDesk leave onto a pending plan row", () => {
    const row = mapRequestLeave(base);
    assert.equal(row?.id, "req:abc");
    assert.equal(row?.leaveType, "annual");
    assert.equal(row?.status, "pending");
    assert.equal(row?.days, 3);
    assert.equal(row?.yearMonth, "2026-10");
    assert.equal(row?.source, "request");
  });

  it("treats a finished approval as taken and a sick request as sick", () => {
    assert.equal(mapRequestLeave({ ...base, status: "approved" })?.status, "taken");
    assert.equal(
      mapRequestLeave({ ...base, requestType: "sick_leave", status: "in_review", leaveTypeRaw: "" })?.leaveType,
      "sick",
    );
    assert.equal(mapRequestLeave({ ...base, status: "rejected" })?.status, "rejected");
  });

  it("skips a request that is not leave or has no dates", () => {
    assert.equal(mapRequestLeave({ ...base, requestType: "loan" }), null);
    assert.equal(mapRequestLeave({ ...base, start: "" }), null);
    assert.equal(mapRequestLeave({ ...base, status: "draft" }), null);
  });

  it("keeps the request when a plan repeats the same rider and dates", () => {
    const request = mapRequestLeave(base);
    assert.ok(request);
    const merged = mergeLeaveRows(
      [{ driverId: "driver-1", start: "2026-10-20", end: "2026-10-22", leaveType: "annual", source: "plan" }],
      [request],
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.source, "request");
  });
});
