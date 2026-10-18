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
import { EMPTY_OPS_SLICERS } from "../performance/performance-ops-types";
import {
  assemblePayrollSnapshot,
  stitchPayrollRange,
  tilePasteOntoSelection,
  type RawPayrollDriver,
} from "./payroll-snapshot";
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

const MANUAL_DRIVER: RawPayrollDriver = {
  id: "d1",
  name: "Ravi Kumar",
  employeeId: "MG-1",
  driverCode: "10001",
  zoneId: null,
  zoneName: null,
  projectKey: "keeta",
  nationality: "IN",
  sourceType: "in_house",
  sourceCompany: "MG",
  status: "active",
  vehicleKey: "bike",
  restaurantId: "r1",
  restaurantName: "Keeta Mall",
};

function assemble(input: {
  checkIns?: Array<{ driverId: string; date: string; hours?: number }>;
  orders?: Array<{ mgId: string; employeeId?: string | null; date: string; orders: number }>;
  adjustments?: Array<{
    driverId: string;
    date: string;
    status: "12" | "3h" | "half" | "off" | "absent" | "custom";
    hours: number | null;
    reason: string | null;
    adjustedAt?: string | null;
  }>;
}) {
  return assemblePayrollSnapshot({
    today: "2026-10-18",
    monthKey: "2026-10",
    slicers: EMPTY_OPS_SLICERS,
    roster: [MANUAL_DRIVER],
    checkIns: input.checkIns ?? [],
    requests: [],
    orders: input.orders ?? [],
    adjustments: input.adjustments ?? [],
  });
}

const MANUAL_CELL = {
  driverId: "d1",
  date: "2026-10-05",
  status: "half" as const,
  hours: 6,
  reason: "Covered a split shift",
  adjustedAt: "2026-10-06T08:00:00.000Z",
};

describe("assemblePayrollSnapshot manual PAYROLL cells", () => {
  it("survives a new attendance and order sheet, which only refresh their own columns", () => {
    const before = assemble({
      checkIns: [{ driverId: "d1", date: "2026-10-05", hours: 9 }],
      orders: [{ mgId: "MG-1", date: "2026-10-05", orders: 4 }],
      adjustments: [MANUAL_CELL],
    });
    const dayBefore = before.riders[0]!.dayInfo.find((d) => d.date === "2026-10-05")!;
    assert.equal(before.riders[0]!.days[4], "half");
    assert.equal(dayBefore.creditedHours, 6);
    assert.equal(dayBefore.loggedHours, 9);
    assert.equal(dayBefore.orders, 4);
    assert.equal(dayBefore.adjusted, true);

    // A re-import writes attendance and recon rows only — the adjustment row is
    // untouched, so the hand-entered cell must be byte-identical afterwards.
    const after = assemble({
      checkIns: [{ driverId: "d1", date: "2026-10-05", hours: 12 }],
      orders: [{ mgId: "MG-1", date: "2026-10-05", orders: 17 }],
      adjustments: [MANUAL_CELL],
    });
    const dayAfter = after.riders[0]!.dayInfo.find((d) => d.date === "2026-10-05")!;
    assert.equal(after.riders[0]!.days[4], "half");
    assert.equal(dayAfter.creditedHours, 6);
    assert.equal(dayAfter.adjustmentStatus, "half");
    assert.equal(dayAfter.adjustmentReason, "Covered a split shift");
    assert.equal(dayAfter.loggedHours, 12);
    assert.equal(dayAfter.orders, 17);
    assert.deepEqual(after.riders[0]!.days, before.riders[0]!.days);
  });

  it("keeps the newest row when the append-only log holds several for one cell", () => {
    const snapshotRows = assemble({
      adjustments: [
        { ...MANUAL_CELL, adjustedAt: "2026-10-07T09:00:00.000Z", status: "off", hours: null, reason: "Later" },
        { ...MANUAL_CELL, adjustedAt: "2026-10-06T08:00:00.000Z", status: "half", hours: 6, reason: "Earlier" },
      ],
    });
    const day = snapshotRows.riders[0]!.dayInfo.find((d) => d.date === "2026-10-05")!;
    assert.equal(snapshotRows.riders[0]!.days[4], "off");
    assert.equal(day.adjustmentReason, "Later");
  });

  it("does not leak a hand-entered cell onto a neighbouring day", () => {
    const snapshotRows = assemble({ adjustments: [MANUAL_CELL] });
    const day = snapshotRows.riders[0]!.dayInfo.find((d) => d.date === "2026-10-06")!;
    assert.equal(day.adjusted, false);
    assert.equal(day.adjustmentStatus, null);
  });
});
