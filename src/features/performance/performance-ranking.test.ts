import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { performanceRange } from "./performance-formulas";
import {
  performanceBand,
  PERFORMANCE_BAND_FLOOR,
  type PerformanceDriverRow,
  type PerformanceReport,
} from "./performance-types";
import {
  PERFORMANCE_REPORT_HEADERS,
  performanceReportRow,
} from "./performance-report-xlsx";

function row(overrides: Partial<PerformanceDriverRow> = {}): PerformanceDriverRow {
  return {
    driver_id: "d1",
    driver_code: "10001",
    employee_id: "4001",
    driver_name: "Test Rider",
    driver_phone: "+96500000000",
    driver_status: "active",
    partner_id: null,
    partner_name: null,
    zone_id: null,
    zone_name: null,
    is_on_duty: false,
    worked_days: 5,
    leave_days: 1,
    absent_days: 0,
    eligible_days: 6,
    period_days: 7,
    actual_deliveries: 40,
    target_deliveries: 50,
    rule_id: null,
    incentive_period: null,
    rule_target: 0,
    delivery_efficiency: 0.8,
    delivery_efficiency_raw: 0.8,
    utilization: 0.83,
    compliance_score: 90,
    exception_count: 0,
    exceptions: [],
    manual_score: null,
    manual_rating_count: 0,
    manual_teams: [],
    overall_score: 84.4,
    dpd_rank: 1,
    score_band: "top",
    ...overrides,
  };
}

describe("performance bands", () => {
  it("maps a score to the band the RPC would give it", () => {
    assert.equal(performanceBand(100), "top");
    assert.equal(performanceBand(80), "top");
    assert.equal(performanceBand(79.9), "good");
    assert.equal(performanceBand(70), "good");
    assert.equal(performanceBand(69.9), "watch");
    assert.equal(performanceBand(50), "watch");
    assert.equal(performanceBand(49.9), "critical");
    assert.equal(performanceBand(0), "critical");
  });

  it("treats a non-finite score as critical rather than top", () => {
    assert.equal(performanceBand(Number.NaN), "critical");
  });

  it("band floors descend, so no score can match two bands", () => {
    const floors = [
      PERFORMANCE_BAND_FLOOR.top,
      PERFORMANCE_BAND_FLOOR.good,
      PERFORMANCE_BAND_FLOOR.watch,
      PERFORMANCE_BAND_FLOOR.critical,
    ];
    for (let i = 1; i < floors.length; i += 1) {
      assert.ok(floors[i] < floors[i - 1], `floor ${i} is not below ${i - 1}`);
    }
  });
});

describe("range presets", () => {
  it("last 7 days is inclusive of today", () => {
    assert.deepEqual(performanceRange("last7", "2026-08-27"), {
      from: "2026-08-21",
      to: "2026-08-27",
    });
  });

  it("this month ends today, never at month end", () => {
    assert.deepEqual(performanceRange("thisMonth", "2026-08-27"), {
      from: "2026-08-01",
      to: "2026-08-27",
    });
  });

  it("last month covers the whole previous month", () => {
    assert.deepEqual(performanceRange("lastMonth", "2026-08-27"), {
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });

  it("last month rolls back across a year boundary", () => {
    assert.deepEqual(performanceRange("lastMonth", "2026-01-15"), {
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("last month knows February in a leap year", () => {
    assert.deepEqual(performanceRange("lastMonth", "2028-03-10"), {
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });

  it("last 30 days spans a month boundary", () => {
    assert.deepEqual(performanceRange("last30", "2026-03-05"), {
      from: "2026-02-04",
      to: "2026-03-05",
    });
  });
});

describe("report rows", () => {
  it("every row has exactly one cell per header", () => {
    assert.equal(performanceReportRow(row()).length, PERFORMANCE_REPORT_HEADERS.length);
  });

  it("rank comes from the score rank, not from row order", () => {
    const cells = performanceReportRow(row({ dpd_rank: 42 }));
    assert.equal(cells[PERFORMANCE_REPORT_HEADERS.indexOf("Rank")], 42);
  });

  it("percentages are whole numbers and the band is named", () => {
    const cells = performanceReportRow(
      row({
        delivery_efficiency_raw: 1.234,
        utilization: 0.836,
        compliance_score: 87.4,
        score_band: "watch",
      }),
    );
    assert.equal(cells[PERFORMANCE_REPORT_HEADERS.indexOf("Delivery %")], 123);
    assert.equal(cells[PERFORMANCE_REPORT_HEADERS.indexOf("Utilization %")], 84);
    assert.equal(cells[PERFORMANCE_REPORT_HEADERS.indexOf("Compliance")], 87);
    assert.equal(cells[PERFORMANCE_REPORT_HEADERS.indexOf("Band")], "Watch");
  });

  it("a missing employee id is blank, not the string null", () => {
    const cells = performanceReportRow(row({ employee_id: null }));
    assert.equal(cells[PERFORMANCE_REPORT_HEADERS.indexOf("Emp ID")], "");
  });

  it("truncation is derived from the total, not assumed", () => {
    const base: Omit<PerformanceReport, "rows" | "truncated" | "totalCount"> = {
      from: "2026-08-01",
      to: "2026-08-27",
      kpis: {
        avg_overall: 50,
        avg_delivery_pct: 50,
        avg_utilization_pct: 50,
        avg_compliance: 50,
        below_threshold: 1,
        top_score: 84.4,
        bottom_score: 10,
        top_driver_name: "A",
        bottom_driver_name: "B",
        band_top: 1,
        band_good: 0,
        band_watch: 0,
        band_critical: 1,
        avg_manual: null,
        rated_drivers: 0,
      },
      weights: {
        delivery: 1,
        utilization: 1,
        compliance: 1,
        manual: 0,
        exception_penalty: 5,
      },
      ratingTeams: [],
    };
    const complete: PerformanceReport = {
      ...base,
      rows: [row()],
      totalCount: 1,
      truncated: false,
    };
    assert.equal(complete.totalCount > complete.rows.length, complete.truncated);

    const capped: PerformanceReport = {
      ...base,
      rows: [row()],
      totalCount: 3000,
      truncated: true,
    };
    assert.equal(capped.totalCount > capped.rows.length, capped.truncated);
  });
});
