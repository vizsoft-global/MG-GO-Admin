import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PAYROLL_DAY_PAINT,
  PAYROLL_STATUS_CHIP,
  combinedEfficiencyPct,
  combinedRequiredHours,
  companyDayHours,
  computeCombinedKpis,
  filterRidersByStatus,
  isCountedDay,
  payrollDayPaint,
  type DayStatus,
} from "./payroll-formulas";
import type { PayrollRiderRow } from "./payroll-types";

const OCT = Array.from(
  { length: 10 },
  (_, index) => `2026-10-${String(index + 1).padStart(2, "0")}`,
);

function row(days: readonly DayStatus[]): { days: DayStatus[] } {
  return { days: [...days] };
}

function blankThen(count: number, status: DayStatus, total = 10): DayStatus[] {
  return Array.from({ length: total }, (_, index) => (index < count ? status : (status as DayStatus)));
}

describe("companyDayHours", () => {
  it("asks 12 h of Americana and 10 h of Keeta", () => {
    assert.equal(companyDayHours("americana"), 12);
    assert.equal(companyDayHours("keeta"), 10);
  });

  it("falls back to the printed client name when the key is empty", () => {
    assert.equal(companyDayHours(null, "Keeta"), 10);
    assert.equal(companyDayHours("", "Americana"), 12);
    assert.equal(companyDayHours(null, null), 12);
  });
});

describe("combinedRequiredHours", () => {
  it("counts five Americana days as 60 h and five Keeta days as 50 h", () => {
    const five = row(blankThen(5, "work", 5));
    assert.equal(combinedRequiredHours(five, OCT.slice(0, 5), "2026-10-05", 12), 60);
    assert.equal(combinedRequiredHours(five, OCT.slice(0, 5), "2026-10-05", 10), 50);
  });

  it("counts ten Americana days as 120 h and ten Keeta days as 100 h", () => {
    const ten = row(blankThen(10, "work", 10));
    assert.equal(combinedRequiredHours(ten, OCT, "2026-10-10", 12), 120);
    assert.equal(combinedRequiredHours(ten, OCT, "2026-10-10", 10), 100);
  });

  it("adds nothing for OFF, Sick, Accident, Leave, Training or Vehicle", () => {
    for (const status of ["off", "sick", "accident", "leave", "training", "vehicle"] as DayStatus[]) {
      assert.equal(isCountedDay(status), false, status);
      assert.equal(combinedRequiredHours(row([status]), [OCT[0]!], OCT[0], 12), 0, status);
    }
  });

  it("counts the Absent kinds and 3-hour / 6-hour days", () => {
    for (const status of ["absent", "abs_lh", "abs_lo", "reduced3", "half", "actual", "custom"] as DayStatus[]) {
      assert.equal(isCountedDay(status), true, status);
      assert.equal(combinedRequiredHours(row([status]), [OCT[0]!], OCT[0], 12), 12, status);
    }
  });

  it("leaves the days after today out", () => {
    const worked = row(blankThen(10, "work", 10));
    assert.equal(combinedRequiredHours(worked, OCT, "2026-10-04", 12), 48);
    assert.equal(combinedRequiredHours(worked, OCT, undefined, 12), 120);
  });

  it("counts a blank day as nothing, so an unworked day cannot ask for hours", () => {
    assert.equal(isCountedDay("blank"), false);
    assert.equal(combinedRequiredHours(row(["blank", "blank"]), OCT.slice(0, 2), "2026-10-02", 12), 0);
  });
});

describe("combinedEfficiencyPct", () => {
  it("is Actual ÷ Required as a percentage", () => {
    assert.equal(combinedEfficiencyPct(60, 60), 100);
    assert.equal(combinedEfficiencyPct(30, 60), 50);
  });

  it("is zero when nothing was required", () => {
    assert.equal(combinedEfficiencyPct(12, 0), 0);
    assert.equal(combinedEfficiencyPct(Number.NaN, 60), 0);
  });
});

describe("computeCombinedKpis", () => {
  it("splits active riders by project and averages efficiency", () => {
    const kpis = computeCombinedKpis([
      { status: "Active", projectKey: "americana", partner: "Americana", efficiency: 100 },
      { status: "Active", projectKey: "keeta", partner: "Keeta", efficiency: 50 },
      { status: "Inactive", projectKey: "keeta", partner: "Keeta", efficiency: 0 },
    ]);
    assert.equal(kpis.riders, 3);
    assert.equal(kpis.active, 2);
    assert.equal(kpis.activeAmericana, 1);
    assert.equal(kpis.activeKeeta, 1);
    assert.equal(kpis.avgEfficiency, 50);
  });
});

describe("shared day palette", () => {
  it("uses the HR fills the SOP names", () => {
    assert.equal(PAYROLL_DAY_PAINT.reduced3.fill, "#BFE4F8");
    assert.equal(PAYROLL_DAY_PAINT.off.fill, "#C9EEC4");
    assert.equal(PAYROLL_DAY_PAINT.sick.fill, "#F28C28");
    assert.equal(PAYROLL_DAY_PAINT.leave.fill, "#F28C28");
    assert.equal(PAYROLL_DAY_PAINT.accident.fill, "#FFE45C");
    assert.equal(PAYROLL_DAY_PAINT.new_hire.fill, "#DCCDF6");
    assert.equal(PAYROLL_DAY_PAINT.training.fill, "#FFD9B0");
    for (const status of ["absent", "terminated", "phone_issue", "id_suspended", "vehicle"] as DayStatus[]) {
      assert.equal(PAYROLL_DAY_PAINT[status].fill, "#D13B3B", status);
    }
  });

  it("keeps Active plain white and 6 Hours white with the dark frame", () => {
    assert.equal(PAYROLL_DAY_PAINT.work.fill, "#FFFFFF");
    // SOP §3: Active is plain white — no frame.
    assert.equal(PAYROLL_DAY_PAINT.work.border, null);
    assert.equal(PAYROLL_DAY_PAINT.half.fill, "#FFFFFF");
    assert.equal(PAYROLL_DAY_PAINT.half.border, "#292A3F");
  });

  it("gives the legend the same fill and border as the cells", () => {
    assert.equal(PAYROLL_STATUS_CHIP.reduced3.hex, PAYROLL_DAY_PAINT.reduced3.fill);
    assert.equal(PAYROLL_STATUS_CHIP.half.border, PAYROLL_DAY_PAINT.half.border);
    assert.equal(PAYROLL_STATUS_CHIP.absent.hex, PAYROLL_DAY_PAINT.absent.fill);
  });

  it("paints Cancelled with its Employee Status tile colour", () => {
    // SOP §3: "same colour as the tile with that name".
    assert.equal(payrollDayPaint("cancelled", "End of Contract").fill, "#1E6B3A");
    assert.equal(payrollDayPaint("cancelled", "Resigned").fill, "#D13B3B");
    assert.equal(payrollDayPaint("cancelled", null).fill, "#D13B3B");
    // Every other status keeps its fixed fill.
    assert.equal(payrollDayPaint("work", "End of Contract").fill, "#FFFFFF");
  });
});

describe("status chip filter", () => {
  const dates = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"];

  function chipRow(days: DayStatus[]): { days: DayStatus[]; dayInfo: { date: string }[] } {
    return { days, dayInfo: dates.map((date) => ({ date })) };
  }

  it("keeps a rider whose matching day has already happened", () => {
    const row = chipRow(["off", "blank", "blank", "blank"]);
    assert.deepEqual(filterRidersByStatus([row], "off", "2026-10-04"), [row]);
  });

  it("drops a rider whose only matching day is still in the future", () => {
    const row = chipRow(["blank", "blank", "blank", "leave"]);
    assert.deepEqual(filterRidersByStatus([row], "leave", "2026-10-02"), []);
    // Without a date the whole month is still scanned, as before.
    assert.deepEqual(filterRidersByStatus([row], "leave"), [row]);
  });

  it("counts today itself", () => {
    const row = chipRow(["blank", "sick", "blank", "blank"]);
    assert.deepEqual(filterRidersByStatus([row], "sick", "2026-10-02"), [row]);
  });
});

/** Keeps the row type honest: the helpers only read `days`. */
const _typed: PayrollRiderRow["days"] = [] as DayStatus[];
void _typed;
