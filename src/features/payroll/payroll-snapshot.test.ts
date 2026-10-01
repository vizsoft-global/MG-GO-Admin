import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computePayrollKpis,
  computeRequestKpis,
  periodFromMonthMeta,
  periodFromRange,
  monthMeta,
  workflowStats,
  type DayStatus,
} from "./payroll-formulas";
import { stitchPayrollRange, tilePasteOntoSelection } from "./payroll-snapshot";
import type { PayrollDayInfo, PayrollRiderRow, PayrollSnapshot } from "./payroll-types";

function dayInfo(date: string, status: DayStatus, credited = 0): PayrollDayInfo {
  return {
    date,
    orders: status === "work" ? 5 : 0,
    loggedHours: credited,
    source: "rule",
    ruleLabel: null,
    adjusted: false,
    adjustmentStatus: null,
    adjustmentHours: null,
    adjustmentReason: null,
    creditedHours: credited,
    autoStatus: status,
    autoHours: credited,
    autoRuleIndex: null,
    autoRuleLabel: null,
    autoSource: "rule",
  };
}

function rider(input: {
  name: string;
  dates: string[];
  days: DayStatus[];
  hours?: number[];
  contractedOff?: number;
}): PayrollRiderRow {
  const hours = input.hours ?? input.days.map((status) => (status === "work" ? 12 : 0));
  const dayInfoRows = input.dates.map((date, i) => dayInfo(date, input.days[i]!, hours[i] ?? 0));
  const contracted = input.contractedOff ?? 2;
  return {
    driverId: "d1",
    amId: "AM-1",
    mgId: "MG-1",
    name: input.name,
    restaurant: "Keeta Mall",
    restaurantId: "r1",
    zone: "Salmiya",
    zoneId: "z1",
    zoneCategory: "good",
    zoneEfficiency: 120,
    zoneDpd: 12,
    zoneOrders: 300,
    partner: "Keeta",
    projectKey: null,
    nationality: "IN",
    nationalityCode: "IN",
    status: "Active",
    vehicleKey: "bike",
    sourceType: "in_house",
    sourceCompany: "MG",
    days: [...input.days],
    dayInfo: dayInfoRows,
    workDays: input.days.filter((s) => s === "work").length,
    totalHours: hours.reduce((a, b) => a + b, 0),
    offDays: 0,
    sickDays: 0,
    accidentDays: 0,
    absentDays: 0,
    reducedDays: 0,
    halfDays: 0,
    actualDays: 0,
    vehicleDays: 0,
    absLhDays: 0,
    absLoDays: 0,
    customDays: 0,
    finalOrders: 0,
    adjustedCells: 0,
    fixedDays: input.dates.length - contracted,
    offStructureDays: contracted,
    offStructureContracted: contracted,
    offStructureSource: "manual",
    offStructureHours: contracted * 12,
    requiredHoursPerDay: 12,
    requiredHours: (input.dates.length - contracted) * 12,
    actualHours: hours.reduce((a, b) => a + b, 0),
    efficiency: 0,
    unjustified: 0,
  };
}

function snapshot(monthKey: string, riderRow: PayrollRiderRow, extra?: Partial<PayrollSnapshot>): PayrollSnapshot {
  const month = periodFromMonthMeta(monthMeta(monthKey)!);
  const riders = [riderRow];
  const requests = extra?.requests ?? [];
  return {
    today: "2026-10-01",
    month,
    months: [monthMeta("2026-10")!, monthMeta("2026-09")!, monthMeta("2026-08")!],
    options: { zones: [], restaurants: [], nationalities: [], sourceCompanies: [] },
    riders,
    requests,
    payrollKpis: computePayrollKpis(riders),
    requestKpis: computeRequestKpis(requests),
    workflow: workflowStats(requests, riders.length),
    zoneMonth: "2026-09",
    clients: extra?.clients ?? [],
    rules: extra?.rules ?? [],
    zoneMetrics: extra?.zoneMetrics ?? [],
    canManage: true,
    ...extra,
    month,
    riders,
  };
}

describe("stitchPayrollRange", () => {
  it("clips each month's days onto the From/To window without re-evaluating them", () => {
    const augDates = ["2026-08-22", "2026-08-23"];
    const sepDates = ["2026-09-04", "2026-09-05"];
    const aug = snapshot(
      "2026-08",
      rider({ name: "August Name", dates: augDates, days: ["work", "absent"], contractedOff: 6 }),
    );
    const sep = snapshot(
      "2026-09",
      rider({ name: "September Name", dates: sepDates, days: ["sick", "work"], contractedOff: 6 }),
    );
    const period = periodFromRange("2026-08-22", "2026-09-05", "2026-10-01");
    const stitched = stitchPayrollRange([aug, sep], period);

    assert.equal(stitched.month.from, "2026-08-22");
    assert.equal(stitched.month.to, "2026-09-05");
    assert.equal(stitched.riders.length, 1);
    const row = stitched.riders[0]!;
    assert.equal(row.name, "September Name");
    assert.equal(row.days[0], "work");
    assert.equal(row.days[1], "absent");
    assert.equal(row.dayInfo[0]?.date, "2026-08-22");
    assert.equal(row.days[period.dates.indexOf("2026-09-04")], "sick");
    assert.equal(row.days[period.dates.indexOf("2026-09-05")], "work");
    assert.equal(row.days[period.dates.indexOf("2026-08-24")], "blank");
    assert.equal(row.offStructureContracted, 6);
    // 6 × 10 Aug days / 30 + 6 × 5 Sep days / 30 = 2 + 1 = 3
    assert.equal(row.offStructureDays, 3);
    assert.equal(row.requiredHours, (period.dates.length - 3) * 12);
  });

  it("keeps requests whose day sits inside the range and drops the rest", () => {
    const req = (id: string, day: string) => ({
      id,
      code: id,
      driverId: "d1",
      riderName: "A",
      riderCode: "MG-1",
      tile: "leave" as const,
      day,
      zone: "Salmiya",
      partner: "Keeta",
      reviewingDept: "HR",
      liveStatus: "approved",
      uiStatus: "approved" as const,
    });
    const aug = snapshot("2026-08", rider({ name: "A", dates: ["2026-08-31"], days: ["off"] }), {
      requests: [req("in", "2026-08-31"), req("out", "2026-08-01")],
    });
    const period = periodFromRange("2026-08-22", "2026-08-31", "2026-10-01");
    const stitched = stitchPayrollRange([aug], period);
    assert.deepEqual(
      stitched.requests.map((r) => r.id),
      ["in"],
    );
  });
});

describe("tilePasteOntoSelection", () => {
  it("tiles a smaller clipboard across a larger selection", () => {
    assert.deepEqual(tilePasteOntoSelection([["12"]], 2, 3), [
      ["12", "12", "12"],
      ["12", "12", "12"],
    ]);
    assert.deepEqual(
      tilePasteOntoSelection(
        [
          ["A", "B"],
          ["C", "D"],
        ],
        4,
        4,
      ),
      [
        ["A", "B", "A", "B"],
        ["C", "D", "C", "D"],
        ["A", "B", "A", "B"],
        ["C", "D", "C", "D"],
      ],
    );
  });

  it("returns empty when there is nothing to paste or select", () => {
    assert.deepEqual(tilePasteOntoSelection([], 3, 3), []);
    assert.deepEqual(tilePasteOntoSelection([["12"]], 0, 2), []);
    assert.deepEqual(tilePasteOntoSelection([[]], 2, 2), []);
  });
});
