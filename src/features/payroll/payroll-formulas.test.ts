import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyCover,
  assertPayrollMonth,
  bucketOf,
  classifyDay,
  classifyRiderMonth,
  computePayrollKpis,
  computeRequestKpis,
  coverKindFor,
  dayLabel,
  emptyCover,
  efficiencyPct,
  fixedDaysFor,
  isAccidentRequest,
  isJustifyingStatus,
  isUnjustifiedDay,
  mapLiveStatusToUi,
  monthMeta,
  keepSelectedPayrollOptions,
  payrollMonthForPreset,
  payrollMonths,
  payrollRiderMatchesSearch,
  payrollTileFor,
  presetForPayrollMonth,
  requestCoversDate,
  requestOverlapsMonth,
  restaurantLabel,
  riderMatchesSlicers,
  workflowStats,
} from "./payroll-formulas";

describe("fixedDays / month selector", () => {
  it("is calendar days minus 2", () => {
    assert.equal(fixedDaysFor(30), 28);
    assert.equal(fixedDaysFor(31), 29);
    assert.equal(monthMeta("2026-02")?.days, 28);
    assert.equal(monthMeta("2026-02")?.fixedDays, 26);
    assert.equal(monthMeta("2024-02")?.days, 29);
    assert.equal(monthMeta("2024-02")?.fixedDays, 27);
  });

  it("exposes exactly 3 months: current + previous 2", () => {
    const months = payrollMonths("2026-09-16");
    assert.deepEqual(
      months.map((m) => m.key),
      ["2026-09", "2026-08", "2026-07"],
    );
    assert.equal(months[0].label, "Sep 2026");
    assert.equal(months.length, 3);
    assert.throws(() => assertPayrollMonth("2026-06", "2026-09-16"), /month_out_of_range/);
    assert.equal(assertPayrollMonth("2026-08", "2026-09-16").days, 31);
  });

  it("filters riders by name, zone, restaurant, AM or MG id", () => {
    const row = {
      name: "Jenson Doe",
      zone: "Hawally",
      restaurant: "Keeta Mall",
      amId: "AM-12",
      mgId: "MG-9",
    };
    assert.equal(payrollRiderMatchesSearch(row, ""), true);
    assert.equal(payrollRiderMatchesSearch(row, "jenson"), true);
    assert.equal(payrollRiderMatchesSearch(row, "hawally"), true);
    assert.equal(payrollRiderMatchesSearch(row, "keeta"), true);
    assert.equal(payrollRiderMatchesSearch(row, "am-12"), true);
    assert.equal(payrollRiderMatchesSearch(row, "mg-9"), true);
    assert.equal(payrollRiderMatchesSearch(row, "unknown"), false);
  });

  it("keeps selected slicer ids in option lists during a refetch gap", () => {
    const next = keepSelectedPayrollOptions(
      { zones: [], restaurants: [], nationalities: [] },
      { zoneIds: ["z1"], restaurantIds: ["r1"], nationalities: ["IN"] },
    );
    assert.deepEqual(next.zones, [{ id: "z1", name: "z1" }]);
    assert.deepEqual(next.restaurants, [{ id: "r1", name: "r1" }]);
    assert.deepEqual(next.nationalities, ["IN"]);
  });

  it("maps This month / Last month / Custom like the Performance range pills", () => {
    assert.equal(payrollMonthForPreset("thisMonth", "2026-09-16", null).key, "2026-09");
    assert.equal(payrollMonthForPreset("lastMonth", "2026-09-16", null).key, "2026-08");
    assert.equal(payrollMonthForPreset("custom", "2026-09-16", "2026-07").key, "2026-07");
    assert.throws(() => payrollMonthForPreset("custom", "2026-09-16", null), /custom_month_required/);
    assert.throws(() => payrollMonthForPreset("custom", "2026-09-16", "2026-06"), /month_out_of_range/);
    assert.equal(presetForPayrollMonth("2026-09", "2026-09-16"), "thisMonth");
    assert.equal(presetForPayrollMonth("2026-08", "2026-09-16"), "lastMonth");
    assert.equal(presetForPayrollMonth("2026-07", "2026-09-16"), "custom");
  });

  it("labels day columns as 1-Sep", () => {
    assert.equal(dayLabel("2026-09", 1), "1-Sep");
    assert.equal(dayLabel("2026-08", 31), "31-Aug");
  });
});

describe("day classifier priority", () => {
  it("future days are blank, not Absent", () => {
    assert.equal(
      classifyDay({
        date: "2026-09-20",
        today: "2026-09-16",
        hasCheckIn: false,
        accident: false,
        sick: false,
        off: false,
      }),
      "blank",
    );
  });

  it("check-in wins over leave on the same day", () => {
    assert.equal(
      classifyDay({
        date: "2026-09-10",
        today: "2026-09-16",
        hasCheckIn: true,
        accident: true,
        sick: true,
        off: true,
      }),
      "work",
    );
  });

  it("Accident beats Sick beats OFF beats Absent", () => {
    assert.equal(
      classifyDay({
        date: "2026-09-10",
        today: "2026-09-16",
        hasCheckIn: false,
        accident: true,
        sick: true,
        off: true,
      }),
      "accident",
    );
    assert.equal(
      classifyDay({
        date: "2026-09-10",
        today: "2026-09-16",
        hasCheckIn: false,
        accident: false,
        sick: true,
        off: true,
      }),
      "sick",
    );
    assert.equal(
      classifyDay({
        date: "2026-09-10",
        today: "2026-09-16",
        hasCheckIn: false,
        accident: false,
        sick: false,
        off: true,
      }),
      "off",
    );
    assert.equal(
      classifyDay({
        date: "2026-09-10",
        today: "2026-09-16",
        hasCheckIn: false,
        accident: false,
        sick: false,
        off: false,
      }),
      "absent",
    );
  });
});

describe("efficiency + buckets", () => {
  it("is uncapped work / FixedDays * 100", () => {
    assert.equal(efficiencyPct(28, 28), 100);
    assert.equal(efficiencyPct(30, 28), (30 / 28) * 100);
    assert.ok(efficiencyPct(30, 28) > 100);
    assert.equal(efficiencyPct(0, 28), 0);
    assert.equal(efficiencyPct(10, 0), 0);
  });

  it("puts 100 in ≥100% and 99.9 in 90–100%", () => {
    assert.equal(bucketOf(100), "gte100");
    assert.equal(bucketOf(110), "gte100");
    assert.equal(bucketOf(99.9), "90_100");
    assert.equal(bucketOf(90), "90_100");
    assert.equal(bucketOf(89.9), "80_90");
    assert.equal(bucketOf(80), "80_90");
    assert.equal(bucketOf(70), "70_80");
    assert.equal(bucketOf(69.9), "lt70");
  });
});

describe("unjustified + status maps", () => {
  it("Approved and awaiting_driver_ack justify; pending does not", () => {
    assert.equal(isJustifyingStatus("approved"), true);
    assert.equal(isJustifyingStatus("awaiting_driver_ack"), true);
    assert.equal(isJustifyingStatus("submitted"), false);
    assert.equal(isJustifyingStatus("in_review"), false);
    assert.equal(isJustifyingStatus("rejected"), false);
  });

  it("Absent and work never need a request", () => {
    assert.equal(isUnjustifiedDay("absent", { accident: false, sick: false, off: false }), false);
    assert.equal(isUnjustifiedDay("work", { accident: false, sick: false, off: false }), false);
    assert.equal(isUnjustifiedDay("off", { accident: false, sick: false, off: false }), true);
    assert.equal(isUnjustifiedDay("off", { accident: false, sick: false, off: true }), false);
    assert.equal(isUnjustifiedDay("accident", { accident: false, sick: false, off: true }), true);
    assert.equal(isUnjustifiedDay("accident", { accident: true, sick: false, off: false }), false);
  });

  it("maps live request statuses onto the 4 chips", () => {
    assert.equal(mapLiveStatusToUi("submitted"), "pending");
    assert.equal(mapLiveStatusToUi("in_review"), "under_review");
    assert.equal(mapLiveStatusToUi("needs_clarification"), "under_review");
    assert.equal(mapLiveStatusToUi("approved"), "approved");
    assert.equal(mapLiveStatusToUi("awaiting_driver_ack"), "approved");
    assert.equal(mapLiveStatusToUi("rejected"), "rejected");
  });
});

describe("request type maps", () => {
  it("Accident comes from leave Accident or sick_leave Accident", () => {
    assert.equal(
      isAccidentRequest({ requestType: "leave", leaveType: "Accident" }),
      true,
    );
    assert.equal(
      isAccidentRequest({ requestType: "sick_leave", leaveSubtype: "Accident" }),
      true,
    );
    assert.equal(
      isAccidentRequest({ requestType: "leave", leaveType: "Annual" }),
      false,
    );
    assert.equal(payrollTileFor({ requestType: "leave", leaveType: "Accident" }), "accident");
    assert.equal(payrollTileFor({ requestType: "leave", leaveType: "Annual" }), "leave");
    assert.equal(payrollTileFor({ requestType: "sick_leave", leaveSubtype: "Injury" }), "sick");
    assert.equal(payrollTileFor({ requestType: "fuel_refund" }), "fuel");
    assert.equal(coverKindFor({ requestType: "leave", leaveType: "Emergency" }), "off");
    assert.equal(coverKindFor({ requestType: "loan" }), null);
  });

  it("inclusive start/end dates cover a day", () => {
    assert.equal(
      requestCoversDate({
        startDate: "2026-09-10",
        endDate: "2026-09-12",
        createdDate: "2026-09-09",
        date: "2026-09-11",
      }),
      true,
    );
    assert.equal(
      requestCoversDate({
        startDate: "2026-09-10",
        endDate: "2026-09-12",
        createdDate: null,
        date: "2026-09-13",
      }),
      false,
    );
  });

  it("month window is start/end overlap, not created_at", () => {
    const rcm0085 = {
      startDate: "2026-11-15",
      endDate: "2027-01-15",
      createdDate: "2026-09-04",
    };
    const rcm0092 = {
      startDate: "2026-08-25",
      endDate: "2026-08-28",
      createdDate: "2026-09-08",
    };
    assert.equal(requestOverlapsMonth(rcm0085, "2026-09"), false);
    assert.equal(requestOverlapsMonth(rcm0085, "2026-08"), false);
    assert.equal(requestOverlapsMonth(rcm0085, "2026-11"), true);
    assert.equal(requestOverlapsMonth(rcm0092, "2026-09"), false);
    assert.equal(requestOverlapsMonth(rcm0092, "2026-08"), true);
  });
});

describe("restaurant + slicers", () => {
  it("Keeta and missing store both become (Pool)", () => {
    assert.equal(restaurantLabel({ projectKey: "keeta", storeName: "KFC" }), "(Pool)");
    assert.equal(restaurantLabel({ projectKey: "americana", storeName: "KFC" }), "KFC");
    assert.equal(restaurantLabel({ projectKey: "americana", storeName: null }), "(Pool)");
  });

  it("empty slicer = all", () => {
    const rider = {
      zoneId: "z1",
      projectKey: "americana",
      vehicleKey: "bike",
      nationality: "KW",
      sourceType: "in_house",
      sourceCompany: "mg",
      restaurantId: "r1",
    };
    assert.equal(
      riderMatchesSlicers(rider, {
        zoneIds: [],
        projectKeys: [],
        vehicleKeys: [],
        nationalities: [],
        sourceTypes: [],
        sourceCompanies: [],
        restaurantIds: [],
      }),
      true,
    );
    assert.equal(
      riderMatchesSlicers(rider, {
        zoneIds: ["z2"],
        projectKeys: [],
        vehicleKeys: [],
        nationalities: [],
        sourceTypes: [],
        sourceCompanies: [],
        restaurantIds: [],
      }),
      false,
    );
  });
});

describe("5 payroll KPI cards", () => {
  const month = monthMeta("2026-08")!;
  const today = "2026-09-16";

  function rider(opts: {
    status: "Active" | "Inactive";
    workDays: number;
    unjustifiedOff?: boolean;
  }) {
    const checkIns = new Set<string>();
    for (let d = 1; d <= opts.workDays; d += 1) {
      checkIns.add(`2026-08-${String(d).padStart(2, "0")}`);
    }
    const covers = new Map();
    if (opts.unjustifiedOff) {
      const flags = emptyCover();
      applyCover(flags, "off", false);
      covers.set("2026-08-15", flags);
    }
    const row = classifyRiderMonth({ month, today, checkInDates: checkIns, coversByDate: covers });
    return { status: opts.status, efficiency: row.efficiency, unjustified: row.unjustified };
  }

  it("computes all five cards including Riders at/above 100%", () => {
    const rows = [
      rider({ status: "Active", workDays: 29 }),
      rider({ status: "Active", workDays: 31 }),
      rider({ status: "Inactive", workDays: 14, unjustifiedOff: true }),
    ];
    const kpis = computePayrollKpis(rows);
    assert.equal(kpis.riders, 3);
    assert.equal(kpis.active, 2);
    assert.equal(kpis.avgEfficiency, rows.reduce((s, r) => s + r.efficiency, 0) / 3);
    assert.equal(kpis.atOrAbove100, 2);
    assert.equal(kpis.unjustifiedRiders, 1);
    assert.ok(rows[0].efficiency === 100);
    assert.ok(rows[1].efficiency > 100);
    assert.ok(rows[2].efficiency < 80);
  });

  it("empty roster zeros every card including at/above 100%", () => {
    assert.deepEqual(computePayrollKpis([]), {
      riders: 0,
      active: 0,
      avgEfficiency: 0,
      atOrAbove100: 0,
      unjustifiedRiders: 0,
    });
  });
});

describe("requests KPIs + workflow stats", () => {
  it("approval rate and awaiting counts", () => {
    const rows = [
      { uiStatus: "pending" as const },
      { uiStatus: "under_review" as const },
      { uiStatus: "approved" as const },
      { uiStatus: "approved" as const },
      { uiStatus: "rejected" as const },
    ];
    const kpis = computeRequestKpis(rows);
    assert.equal(kpis.total, 5);
    assert.equal(kpis.pending, 1);
    assert.equal(kpis.underReview, 1);
    assert.equal(kpis.approved, 2);
    assert.equal(kpis.rejected, 1);
    assert.equal(kpis.approvalRate, 40);

    const wf = workflowStats(rows, 2);
    assert.equal(wf.awaitingAction, 2);
    assert.equal(wf.requestsPerRider, 2.5);
  });

  it("Requests / rider is 0.0 when no riders", () => {
    assert.deepEqual(workflowStats([{ uiStatus: "pending" }], 0), {
      awaitingAction: 1,
      requestsPerRider: 0,
    });
  });
});
