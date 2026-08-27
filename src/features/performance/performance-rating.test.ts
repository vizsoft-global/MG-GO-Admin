import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeOverallScore,
  parsePerformanceWeights,
  ratingPeriodMonth,
} from "./performance-formulas";
import {
  manualRatingToScore,
  scoreToStars,
  DEFAULT_PERFORMANCE_WEIGHTS,
  RATING_SCALE_MAX,
  type PerformanceDriverRow,
  type PerformanceReportTeam,
} from "./performance-types";
import {
  performanceReportHeaders,
  performanceReportRow,
  PERFORMANCE_REPORT_HEADERS,
} from "./performance-report-xlsx";

const RATED_WEIGHTS = { ...DEFAULT_PERFORMANCE_WEIGHTS, manual: 1 };

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

describe("manual rating normalisation", () => {
  it("preserves the midpoint: 3 of 5 is average, so it is 50", () => {
    assert.equal(manualRatingToScore(1), 0);
    assert.equal(manualRatingToScore(2), 25);
    assert.equal(manualRatingToScore(3), 50);
    assert.equal(manualRatingToScore(4), 75);
    assert.equal(manualRatingToScore(RATING_SCALE_MAX), 100);
  });

  it("the worst rating is worth nothing, not a fifth of the score", () => {
    // score / 5 would hand a rider rated 1 of 5 twenty points.
    assert.notEqual(manualRatingToScore(1), 20);
    assert.equal(manualRatingToScore(1), 0);
  });

  it("clamps out-of-range input rather than extrapolating", () => {
    assert.equal(manualRatingToScore(0), 0);
    assert.equal(manualRatingToScore(9), 100);
    assert.equal(manualRatingToScore(Number.NaN), 0);
  });

  it("round-trips a rating through the score and back", () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      assert.equal(scoreToStars(manualRatingToScore(rating)), rating);
    }
  });

  it("a team average between two ratings survives the round trip", () => {
    // Two teams at 4 and one at 3 averages to 3.67.
    const average = (4 + 4 + 3) / 3;
    assert.equal(scoreToStars(manualRatingToScore(average)), 3.7);
  });
});

describe("weight parsing with the manual key", () => {
  it("defaults the manual weight to 0 so a deploy moves no score", () => {
    assert.equal(DEFAULT_PERFORMANCE_WEIGHTS.manual, 0);
    assert.equal(parsePerformanceWeights({}).manual, 0);
  });

  it("reads a configured manual weight", () => {
    assert.equal(parsePerformanceWeights({ manual: 2 }).manual, 2);
    assert.equal(parsePerformanceWeights({ manual: 0.5 }).manual, 0.5);
  });

  it("rejects a negative or unparseable manual weight", () => {
    assert.equal(parsePerformanceWeights({ manual: -3 }).manual, 0);
    assert.equal(parsePerformanceWeights({ manual: "heavy" }).manual, 0);
    assert.equal(parsePerformanceWeights({ manual: null }).manual, 0);
  });

  it("leaves the other weights alone", () => {
    const parsed = parsePerformanceWeights({ manual: 4 });
    assert.equal(parsed.delivery, 1);
    assert.equal(parsed.utilization, 1);
    assert.equal(parsed.compliance, 1);
    assert.equal(parsed.exception_penalty, 5);
  });
});

describe("blending the rating into the score", () => {
  it("a manual weight of 0 cannot move the score", () => {
    const withRating = computeOverallScore(0.8, 0.8, 80, DEFAULT_PERFORMANCE_WEIGHTS, 100);
    const without = computeOverallScore(0.8, 0.8, 80, DEFAULT_PERFORMANCE_WEIGHTS, null);
    assert.equal(withRating, without);
    assert.equal(withRating, 80);
  });

  it("an unrated driver scores exactly what they scored with no manual weight", () => {
    const unratedWithWeight = computeOverallScore(0.9, 0.9, 90, RATED_WEIGHTS, null);
    const noManualWeightAtAll = computeOverallScore(
      0.9,
      0.9,
      90,
      DEFAULT_PERFORMANCE_WEIGHTS,
      null,
    );
    assert.equal(unratedWithWeight, noManualWeightAtAll);
    assert.equal(unratedWithWeight, 90);
  });

  it("renormalises rather than treating an absent rating as zero", () => {
    // 3 automatic components at 0.9 plus a 4th at 0 would be 67.5.
    assert.notEqual(computeOverallScore(0.9, 0.9, 90, RATED_WEIGHTS, null), 67.5);
  });

  it("a rating of 3 of 5 pulls a 90 toward the middle", () => {
    const score = computeOverallScore(
      0.9,
      0.9,
      90,
      RATED_WEIGHTS,
      manualRatingToScore(3),
    );
    // (90 + 90 + 90 + 50) / 4
    assert.equal(score, 80);
  });

  it("the best possible rating cannot push a rider past 100", () => {
    const score = computeOverallScore(1, 1, 100, RATED_WEIGHTS, 100);
    assert.equal(score, 100);
  });

  it("the worst rating is a real penalty once the weight is on", () => {
    const worst = computeOverallScore(0.9, 0.9, 90, RATED_WEIGHTS, manualRatingToScore(1));
    // (90 + 90 + 90 + 0) / 4
    assert.equal(worst, 67.5);
  });

  it("a heavier manual weight moves the score further", () => {
    const light = computeOverallScore(0.9, 0.9, 90, { ...RATED_WEIGHTS, manual: 1 }, 0);
    const heavy = computeOverallScore(0.9, 0.9, 90, { ...RATED_WEIGHTS, manual: 3 }, 0);
    assert.ok(heavy < light, "a heavier weight should pull harder");
  });

  it("a NaN rating is treated as unrated, not as zero", () => {
    const nan = computeOverallScore(0.9, 0.9, 90, RATED_WEIGHTS, Number.NaN);
    assert.equal(nan, 90);
  });
});

describe("rating period", () => {
  it("is the first of the Kuwait month the date falls in", () => {
    assert.equal(ratingPeriodMonth("2026-08-27"), "2026-08-01");
    assert.equal(ratingPeriodMonth("2026-08-01"), "2026-08-01");
    assert.equal(ratingPeriodMonth("2026-12-31"), "2026-12-01");
  });

  it("every day of a month maps to the same period, so a rating is one fact", () => {
    const first = ratingPeriodMonth("2026-08-01");
    for (const day of ["05", "14", "27", "31"]) {
      assert.equal(ratingPeriodMonth(`2026-08-${day}`), first);
    }
  });
});

describe("report rating columns", () => {
  const teams: PerformanceReportTeam[] = [
    { key: "fleet", label: "Fleet" },
    { key: "hr", label: "HR" },
    { key: "operations", label: "Operations" },
  ];

  it("adds one column per team, after the fixed columns", () => {
    const headers = performanceReportHeaders(teams);
    assert.equal(headers.length, PERFORMANCE_REPORT_HEADERS.length + teams.length);
    assert.equal(headers.at(-3), "Fleet (1-5)");
    assert.equal(headers.at(-1), "Operations (1-5)");
    // Fixed columns keep their positions whatever the tenant's teams are.
    assert.equal(
      headers.indexOf("Score"),
      PERFORMANCE_REPORT_HEADERS.indexOf("Score"),
    );
  });

  it("a row has exactly one cell per header, teams included", () => {
    const headers = performanceReportHeaders(teams);
    assert.equal(performanceReportRow(row(), teams).length, headers.length);
  });

  it("a team that rated nobody still gets a column, marked as unrated", () => {
    const cells = performanceReportRow(
      row({
        manual_score: 75,
        manual_rating_count: 1,
        manual_teams: [
          {
            team_key: "fleet",
            score: 4,
            months_rated: 1,
            last_rated_at: "2026-08-20T00:00:00Z",
          },
        ],
      }),
      teams,
    );
    const headers = performanceReportHeaders(teams);
    assert.equal(cells[headers.indexOf("Fleet (1-5)")], 4);
    assert.equal(cells[headers.indexOf("HR (1-5)")], "—");
    assert.equal(cells[headers.indexOf("Operations (1-5)")], "—");
  });

  it("the rating cell shows the 1-5 a rater picked, not the 0-100 score", () => {
    const cells = performanceReportRow(row({ manual_score: 75 }), teams);
    const headers = performanceReportHeaders(teams);
    assert.equal(cells[headers.indexOf("Rating")], 4);
  });

  it("an unrated driver reads as unrated, never as the worst rating", () => {
    const cells = performanceReportRow(row({ manual_score: null }), teams);
    const headers = performanceReportHeaders(teams);
    assert.equal(cells[headers.indexOf("Rating")], "—");
  });

  it("no teams configured yields the fixed columns only", () => {
    assert.deepEqual(performanceReportHeaders([]), [...PERFORMANCE_REPORT_HEADERS]);
    assert.equal(
      performanceReportRow(row()).length,
      PERFORMANCE_REPORT_HEADERS.length,
    );
  });
});
