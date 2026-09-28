import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildComparisonRiders,
  comparisonKpis,
  comparisonPeriod,
  comparisonResult,
  dailyTotals,
  daysInRange,
  diffTint,
  lastDayCol,
  monthContaining,
  normalizeMgId,
  ridersInBoth,
  ridersNotUsingApp,
  weekdayShort,
  type ComparisonSnapshot,
} from "./order-comparison-model";

describe("order-comparison-model", () => {
  it("normalises MG IDs: trim, case, and Excel .0 numbers", () => {
    assert.equal(normalizeMgId(" 10421 "), "10421");
    assert.equal(normalizeMgId("AbC"), "abc");
    assert.equal(normalizeMgId("10421.0"), "10421");
    assert.equal(normalizeMgId(10421), "10421");
    assert.equal(normalizeMgId("01001"), "01001");
  });

  it("uses the workbook result rule including No orders", () => {
    assert.equal(comparisonResult(0, 0), "no_orders");
    assert.equal(comparisonResult(10, 10), "match");
    assert.equal(comparisonResult(10, 0), "not_using_app");
    assert.equal(comparisonResult(0, 8), "mggo_only");
    assert.equal(comparisonResult(12, 9), "am_higher");
    assert.equal(comparisonResult(9, 12), "mggo_higher");
  });

  it("matches SOP examples: AM − MGGO and unused", () => {
    assert.equal(13 - 10, 3);
    assert.equal(comparisonResult(13, 10), "am_higher");
    assert.equal(comparisonResult(10, 0), "not_using_app");
    assert.equal(comparisonResult(0, 7), "mggo_only");
  });

  it("uses the reference tint steps", () => {
    assert.deepEqual(diffTint(0), { bg: "", fg: "" });
    assert.deepEqual(diffTint(1), { bg: "#dbe3fb", fg: "#1e3a9e" });
    assert.deepEqual(diffTint(3), { bg: "#a9baf5", fg: "#1e3a9e" });
    assert.deepEqual(diffTint(5), { bg: "#6f8cee", fg: "#fff" });
    assert.deepEqual(diffTint(-1), { bg: "#d3f4e9", fg: "#06684a" });
    assert.deepEqual(diffTint(-4), { bg: "#96e3c8", fg: "#06684a" });
    assert.deepEqual(diffTint(-9), { bg: "#45c69c", fg: "#fff" });
  });

  it("matches on MG ID only and unions both sides", () => {
    const days = daysInRange("2026-08-01", "2026-08-03");
    const snapshot: ComparisonSnapshot = {
      from: "2026-08-01",
      to: "2026-08-03",
      am: [
        { mg_id: "10421.0", work_date: "2026-08-01", orders: 4, rider_name: "Ada AM" },
        { mg_id: "10421", work_date: "2026-08-02", orders: 6, rider_name: "Ada AM" },
        { mg_id: "20001", work_date: "2026-08-01", orders: 8, rider_name: "No App" },
      ],
      mggo: [
        { mg_id: "10421", work_date: "2026-08-01", orders: 4 },
        { mg_id: "10421", work_date: "2026-08-02", orders: 3 },
        { mg_id: "30001", work_date: "2026-08-03", orders: 5 },
      ],
      riders: [
        { mg_id: "10421", rider_name: "Ada Profile", restaurant_name: "Crystal Tower" },
        { mg_id: "30001", rider_name: "Only App", restaurant_name: "—" },
      ],
    };
    const riders = buildComparisonRiders(snapshot, days);
    assert.equal(riders.length, 3);
    const ada = riders.find((r) => r.mgId === "10421");
    assert.ok(ada);
    assert.equal(ada?.name, "Ada Profile");
    assert.equal(ada?.restaurant, "Crystal Tower");
    assert.equal(ada?.am, 10);
    assert.equal(ada?.mggo, 7);
    assert.equal(ada?.diff, 3);
    assert.equal(ada?.result, "am_higher");
    assert.equal(ada?.offDays, 1);
    assert.equal(ada?.diffPct, 0.3);

    const unused = riders.find((r) => r.mgId === "20001");
    assert.equal(unused?.result, "not_using_app");
    assert.equal(unused?.restaurant, "—");
    assert.equal(unused?.name, "No App");

    const only = riders.find((r) => r.mgId === "30001");
    assert.equal(only?.result, "mggo_only");
    assert.equal(only?.diffPct, null);
  });

  it("sorts by |difference| desc and builds KPIs + daily series", () => {
    const days = ["2026-08-01", "2026-08-02"];
    const riders = buildComparisonRiders(
      {
        from: days[0]!,
        to: days[1]!,
        am: [
          { mg_id: "1", work_date: "2026-08-01", orders: 2, rider_name: "A" },
          { mg_id: "2", work_date: "2026-08-01", orders: 10, rider_name: "B" },
          { mg_id: "3", work_date: "2026-08-01", orders: 4, rider_name: "C" },
        ],
        mggo: [
          { mg_id: "1", work_date: "2026-08-01", orders: 2 },
          { mg_id: "2", work_date: "2026-08-01", orders: 1 },
          { mg_id: "3", work_date: "2026-08-01", orders: 4 },
        ],
        riders: [],
      },
      days,
    );
    assert.deepEqual(
      riders.map((r) => r.mgId),
      ["2", "1", "3"],
    );
    const kpi = comparisonKpis(riders);
    assert.equal(kpi.riders, 3);
    assert.equal(kpi.am, 16);
    assert.equal(kpi.mggo, 7);
    assert.equal(kpi.net, 9);
    assert.equal(kpi.matches, 2);
    assert.equal(kpi.matchRate, 2 / 3);
    const amHigher = kpi.cards.find((c) => c.result === "am_higher");
    assert.equal(amHigher?.count, 1);
    assert.equal(amHigher?.am, 10);

    const daily = dailyTotals(riders, days);
    assert.equal(daily[0]?.am, 16);
    assert.equal(daily[0]?.mggo, 7);
    assert.equal(daily[0]?.diff, 9);
    assert.equal(daily[0]?.ridersOff, 1);
    assert.equal(ridersInBoth(riders).length, 3);
    assert.equal(ridersNotUsingApp(riders).length, 0);
  });

  it("resolves period chips and August 2026 weekday headers", () => {
    assert.deepEqual(comparisonPeriod("thisMonth", "2026-09-28"), {
      from: "2026-09-01",
      to: "2026-09-28",
    });
    assert.deepEqual(comparisonPeriod("lastMonth", "2026-09-28"), {
      from: "2026-08-01",
      to: "2026-08-31",
    });
    assert.equal(weekdayShort("2026-08-01"), "Sat");
    assert.equal(monthContaining("2026-08-15").to, "2026-08-31");
    assert.equal(lastDayCol(31), "AG");
    assert.equal(lastDayCol(30), "AF");
  });
});
