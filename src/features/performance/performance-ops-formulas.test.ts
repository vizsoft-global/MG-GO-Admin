import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDelta, formatOpsMetricValue } from "./performance-ops-format";
import {
  assertCustomOpsRange,
  assertOpsRange,
  DEFAULT_TARGET_DPD,
  displayRiderId,
  dpdEfficiencyPct,
  efficiencyBucket,
  fillCustomPreset,
  matchingCustomPreset,
  attachTrendEff,
  bucketOpsTrend,
  companyKeyOf,
  companyRowsFromRiders,
  DEFAULT_OPS_PRESET,
  formatOpsBucketLabel,
  formatOpsCustomPill,
  formatOpsTrendLabel,
  inclusiveDayCount,
  isChartableDimKey,
  opsBarColorForKey,
  kpiDeltaPct,
  meanFinite,
  overallDpd,
  parseSourceCompany,
  partnerFilterMode,
  previousWindow,
  resolveBenchmark,
  lastDayOfMonth,
  opsWeekBucketStart,
  opsYearOptions,
  resetOpsPeriod,
  resolveOpsRange,
  resolveOpsTrendWindow,
  resolveViewByMetric,
  riderDpd,
  sortOpsRidersByOrdersDesc,
  sourceLabel,
  storeDisplayName,
  storesVisibleForPartners,
  targetEfficiencyPct,
  toggleOpsMultiSelect,
  topBottomN,
} from "./performance-ops-formulas";

describe("riderDpd / overallDpd", () => {
  it("is orders / working days and null when no working days", () => {
    assert.equal(riderDpd(50, 2), 25);
    assert.equal(riderDpd(10, 0), null);
    assert.equal(riderDpd(10, -1), null);
  });

  it("overall DPD is the pooled ratio, not the mean of rider DPDs", () => {
    const a = { orders: 100, days: 2 }; // 50
    const b = { orders: 10, days: 10 }; // 1
    const meanOfRiders = ((50 + 1) / 2);
    const pooled = overallDpd(a.orders + b.orders, a.days + b.days);
    assert.equal(pooled, 110 / 12);
    assert.notEqual(pooled, meanOfRiders);
  });
});

describe("resolveBenchmark", () => {
  it("Americana filter uses Store DPD only", () => {
    assert.equal(
      resolveBenchmark({
        projectKey: "americana",
        partnerKeys: ["americana"],
        storeDpd: 20,
        zoneVehicleDpd: 40,
      }),
      20,
    );
  });

  it("Keeta filter uses Zone-Vehicle DPD only", () => {
    assert.equal(
      resolveBenchmark({
        projectKey: "keeta",
        partnerKeys: ["keeta"],
        storeDpd: 20,
        zoneVehicleDpd: 40,
      }),
      40,
    );
  });

  it("no partner filter averages both when both exist", () => {
    assert.equal(
      resolveBenchmark({
        projectKey: "americana",
        partnerKeys: [],
        storeDpd: 20,
        zoneVehicleDpd: 40,
      }),
      30,
    );
  });

  it("assumption #2: missing side uses the side that exists (never 0)", () => {
    assert.equal(
      resolveBenchmark({
        projectKey: "keeta",
        partnerKeys: [],
        storeDpd: null,
        zoneVehicleDpd: 18,
      }),
      18,
    );
    assert.equal(
      resolveBenchmark({
        projectKey: "americana",
        partnerKeys: [],
        storeDpd: 22,
        zoneVehicleDpd: null,
      }),
      22,
    );
    assert.equal(
      resolveBenchmark({
        projectKey: "keeta",
        partnerKeys: [],
        storeDpd: null,
        zoneVehicleDpd: null,
      }),
      null,
    );
  });

  it("selecting both partners is the same as no partner filter", () => {
    assert.equal(partnerFilterMode(["americana", "keeta"]), "all");
    assert.equal(
      resolveBenchmark({
        projectKey: "americana",
        partnerKeys: ["americana", "keeta"],
        storeDpd: 10,
        zoneVehicleDpd: 20,
      }),
      15,
    );
  });
});

describe("efficiency", () => {
  it("DPD Efficiency is rider DPD / benchmark × 100, uncapped", () => {
    assert.equal(dpdEfficiencyPct(30, 20), 150);
    assert.equal(dpdEfficiencyPct(null, 20), null);
    assert.equal(dpdEfficiencyPct(10, 0), null);
    assert.equal(dpdEfficiencyPct(10, null), null);
  });

  it("Target Efficiency is rider DPD / 25 × 100", () => {
    assert.equal(targetEfficiencyPct(25, DEFAULT_TARGET_DPD), 100);
    assert.equal(targetEfficiencyPct(50, DEFAULT_TARGET_DPD), 200);
    assert.equal(targetEfficiencyPct(null, DEFAULT_TARGET_DPD), null);
  });

  it("AVG is the mean of rider-level percentages", () => {
    assert.equal(meanFinite([100, 50, null]), 75);
    assert.equal(meanFinite([null, null]), null);
  });

  it("buckets use the locked boundaries", () => {
    assert.equal(efficiencyBucket(120.1), "well_above");
    assert.equal(efficiencyBucket(120), "above");
    assert.equal(efficiencyBucket(100), "above");
    assert.equal(efficiencyBucket(99.9), "near");
    assert.equal(efficiencyBucket(80), "near");
    assert.equal(efficiencyBucket(79.9), "below");
    assert.equal(efficiencyBucket(60), "below");
    assert.equal(efficiencyBucket(59.9), "well_below");
    assert.equal(efficiencyBucket(null), null);
  });
});

describe("topBottomN", () => {
  it("clamps round(count/10) between 2 and 10; empty is 0", () => {
    assert.equal(topBottomN(0), 0);
    assert.equal(topBottomN(10), 2);
    assert.equal(topBottomN(14), 2);
    assert.equal(topBottomN(15), 2);
    assert.equal(topBottomN(16), 2);
    assert.equal(topBottomN(100), 10);
    assert.equal(topBottomN(200), 10);
  });
});

describe("kpiDelta + windows", () => {
  it("diffs the card values directly (assumption #1)", () => {
    assert.equal(kpiDeltaPct(120, 100), 20);
    assert.equal(kpiDeltaPct(25, 20), 25);
    assert.equal(kpiDeltaPct(10, 0), null);
    assert.equal(kpiDeltaPct(null, 10), null);
    assert.deepEqual(formatDelta(120, null), { text: "", tone: "flat" });
    assert.deepEqual(formatDelta(120, 100), { text: "+20.0%", tone: "up" });
  });

  it("chart tooltip rounds DPD Efficiency to one decimal percent", () => {
    assert.equal(formatOpsMetricValue("dpd_eff", 241.7147483506631), "241.7%");
    assert.equal(formatOpsMetricValue("tgt_eff", 99.94), "99.9%");
    assert.equal(formatOpsMetricValue("dpd", 12.345), "12.3");
    assert.equal(formatOpsMetricValue("orders", 1500), "1,500");
    assert.equal(formatOpsMetricValue("riders", 8), "8");
    assert.equal(formatOpsMetricValue("dpd_eff", null), "—");
  });

  it("previous window is the N days immediately before from", () => {
    assert.equal(inclusiveDayCount("2026-09-06", "2026-09-12"), 7);
    assert.deepEqual(previousWindow("2026-09-06", "2026-09-12"), {
      from: "2026-08-30",
      to: "2026-09-05",
    });
  });

  it("This Month ends today; Last Month is the previous calendar month", () => {
    assert.deepEqual(resolveOpsRange("thisMonth", "2026-09-12", null), {
      from: "2026-09-01",
      to: "2026-09-12",
    });
    assert.deepEqual(resolveOpsRange("lastMonth", "2026-09-12", null), {
      from: "2026-08-01",
      to: "2026-08-31",
    });
    assert.deepEqual(resolveOpsRange("last7", "2026-09-12", null), {
      from: "2026-09-06",
      to: "2026-09-12",
    });
  });

  it("All Time raises when the span is over 400 days", () => {
    assert.throws(
      () => resolveOpsRange("all", "2026-09-12", "2025-01-01"),
      /range_too_large/,
    );
    assert.deepEqual(resolveOpsRange("all", "2026-09-12", "2026-08-01"), {
      from: "2026-08-01",
      to: "2026-09-12",
    });
    assert.throws(() => assertOpsRange("2025-01-01", "2026-09-12"), /range_too_large/);
  });

  it("Custom range validates empty, order, 366, and future", () => {
    assert.throws(() => assertCustomOpsRange("", "2026-09-12", "2026-09-12"), /custom_range_incomplete/);
    assert.throws(() => assertCustomOpsRange("2026-09-12", "2026-09-01", "2026-09-12"), /custom_range_order/);
    assert.throws(() => assertCustomOpsRange("2025-01-01", "2026-09-12", "2026-09-12"), /custom_range_too_large/);
    assert.throws(() => assertCustomOpsRange("2026-09-01", "2026-09-20", "2026-09-12"), /custom_range_future/);
    assert.doesNotThrow(() => assertCustomOpsRange("2026-08-30", "2026-09-12", "2026-09-12"));
    assert.deepEqual(resolveOpsRange("custom", "2026-09-12", null, {
      from: "2026-08-30",
      to: "2026-09-12",
    }), { from: "2026-08-30", to: "2026-09-12" });
    assert.deepEqual(fillCustomPreset("14", "2026-09-12"), { from: "2026-08-30", to: "2026-09-12" });
    assert.deepEqual(fillCustomPreset("quarter", "2026-09-12"), { from: "2026-07-01", to: "2026-09-12" });
    assert.equal(matchingCustomPreset("2026-08-30", "2026-09-12", "2026-09-12"), "14");
    assert.equal(matchingCustomPreset("2026-08-14", "2026-09-12", "2026-09-12"), "30");
    assert.equal(matchingCustomPreset("2026-06-15", "2026-09-12", "2026-09-12"), "90");
    assert.equal(matchingCustomPreset("2026-07-01", "2026-09-12", "2026-09-12"), "quarter");
    assert.equal(matchingCustomPreset("2026-09-01", "2026-09-12", "2026-09-12"), null);
  });
});

describe("chart labels + dim keys + multi-select + rider sort", () => {
  it("formats buckets as 1 Sep", () => {
    assert.equal(formatOpsBucketLabel("2026-09-01"), "1 Sep");
    assert.equal(formatOpsBucketLabel("2026-09-12"), "12 Sep");
    assert.equal(formatOpsCustomPill("2026-09-01", "2026-09-12"), "1 Sep – 12 Sep");
  });

  it("drops empty and mojibake dim keys", () => {
    assert.equal(isChartableDimKey(null), false);
    assert.equal(isChartableDimKey(""), false);
    assert.equal(isChartableDimKey("—"), false);
    assert.equal(isChartableDimKey("(none)"), false);
    assert.equal(isChartableDimKey("â€”"), false);
    assert.equal(isChartableDimKey("Jahra"), true);
  });

  it("assigns a stable palette color per category key", () => {
    assert.equal(opsBarColorForKey("Jahra"), opsBarColorForKey("Jahra"));
    assert.notEqual(opsBarColorForKey("Jahra"), opsBarColorForKey("Hawally"));
  });

  it("multi-select starts from All and ticks only chosen values", () => {
    const opts = ["a", "b", "c", "d"];
    assert.deepEqual(toggleOpsMultiSelect(opts, [], "b"), ["b"]);
    assert.deepEqual(toggleOpsMultiSelect(opts, ["b"], "c"), ["b", "c"]);
    assert.deepEqual(toggleOpsMultiSelect(opts, ["b", "c"], "b"), ["c"]);
    assert.deepEqual(toggleOpsMultiSelect(opts, ["c"], "c"), []);
    assert.deepEqual(toggleOpsMultiSelect(opts, ["a", "b", "c"], "d"), []);
  });

  it("default rider sort is Orders desc then name", () => {
    const rows = [
      { name: "Ann", orders: 0 },
      { name: "Zed", orders: 12 },
      { name: "Bo", orders: 12 },
    ];
    assert.deepEqual(sortOpsRidersByOrdersDesc(rows).map((r) => r.name), ["Bo", "Zed", "Ann"]);
  });

  it("View charts by falls back when the tab does not have the metric", () => {
    assert.equal(resolveViewByMetric("dpd", "orders"), "dpd");
    assert.equal(resolveViewByMetric("overview", "dpd"), "dpd");
    assert.equal(resolveViewByMetric("riders", "orders"), "orders");
  });
});

describe("store slicer + display", () => {
  it("hides stores when the partner set excludes Americana", () => {
    assert.equal(storesVisibleForPartners([]), true);
    assert.equal(storesVisibleForPartners(["americana"]), true);
    assert.equal(storesVisibleForPartners(["americana", "keeta"]), true);
    assert.equal(storesVisibleForPartners(["keeta"]), false);
  });

  it("Keeta store is (Pool); missing Americana store is a dash", () => {
    assert.equal(storeDisplayName({ projectKey: "keeta", storeName: "KFC" }), "(Pool)");
    assert.equal(storeDisplayName({ projectKey: "americana", storeName: "KFC" }), "KFC");
    assert.equal(storeDisplayName({ projectKey: "americana", storeName: null }), "—");
  });
});

describe("parseSourceCompany", () => {
  it("accepts keys, prefixes, labels, and blank — never guesses from an ID", () => {
    assert.equal(parseSourceCompany(""), null);
    assert.equal(parseSourceCompany("  "), null);
    assert.equal(parseSourceCompany("mg"), "mg");
    assert.equal(parseSourceCompany("BRK"), "brk");
    assert.equal(parseSourceCompany("SD"), "sadeeq");
    assert.equal(parseSourceCompany("Sadeeq"), "sadeeq");
    assert.equal(parseSourceCompany("KN014"), "invalid");
    assert.equal(parseSourceCompany("acme"), "invalid");
  });
});

describe("display ID comes from stored source_company", () => {
  it("does not parse a prefix out of the employee id", () => {
    assert.equal(
      displayRiderId({
        sourceCompany: "brk",
        employeeId: "032",
        driverCode: "10032",
      }),
      "BRK032",
    );
    assert.equal(
      displayRiderId({
        sourceCompany: "sadeeq",
        employeeId: "014",
        driverCode: null,
      }),
      "SD014",
    );
    assert.equal(
      displayRiderId({
        sourceCompany: "mg",
        employeeId: "7051",
        driverCode: "17051",
      }),
      "7051",
    );
    assert.equal(
      displayRiderId({
        sourceCompany: null,
        employeeId: "KN014",
        driverCode: null,
      }),
      "KN014",
    );
  });

  it("blank source_company is the Unassigned company key", () => {
    assert.equal(companyKeyOf(null), "unassigned");
    assert.equal(companyKeyOf("  "), "unassigned");
    assert.equal(companyKeyOf("brk"), "brk");
  });
});

describe("trend window + 4-week buckets", () => {
  it("weekly window is the month of the period end, clipped to today", () => {
    assert.deepEqual(
      resolveOpsTrendWindow("weekly", { from: "2026-09-17", to: "2026-09-23" }, null, "2026-09-23"),
      { from: "2026-09-01", to: "2026-09-23" },
    );
    assert.deepEqual(
      resolveOpsTrendWindow("weekly", { from: "2026-08-01", to: "2026-08-31" }, null, "2026-09-23"),
      { from: "2026-08-01", to: "2026-08-31" },
    );
  });

  it("monthly is Jan→today for the current year and Jan–Dec for a past year", () => {
    assert.deepEqual(
      resolveOpsTrendWindow("monthly", { from: "2026-09-01", to: "2026-09-23" }, 2026, "2026-09-23"),
      { from: "2026-01-01", to: "2026-09-23" },
    );
    assert.deepEqual(
      resolveOpsTrendWindow("monthly", { from: "2026-09-01", to: "2026-09-23" }, 2025, "2026-09-23"),
      { from: "2025-01-01", to: "2025-12-31" },
    );
  });

  it("daily trend window equals the period", () => {
    assert.deepEqual(
      resolveOpsTrendWindow("daily", { from: "2026-09-01", to: "2026-09-23" }, 2026, "2026-09-23"),
      { from: "2026-09-01", to: "2026-09-23" },
    );
  });

  it("week 4 absorbs days 29–31; This Month stops at the current week", () => {
    assert.equal(opsWeekBucketStart("2026-08-01"), "2026-08-01");
    assert.equal(opsWeekBucketStart("2026-08-08"), "2026-08-08");
    assert.equal(opsWeekBucketStart("2026-08-15"), "2026-08-15");
    assert.equal(opsWeekBucketStart("2026-08-22"), "2026-08-22");
    assert.equal(opsWeekBucketStart("2026-08-29"), "2026-08-22");
    assert.equal(opsWeekBucketStart("2026-08-31"), "2026-08-22");
    assert.equal(lastDayOfMonth("2026-08-01"), "2026-08-31");
    const sep = [
      { bucket: "2026-09-01", orders: 10, working_days: 2, dpd: 5, dpd_eff: null, tgt_eff: null },
      { bucket: "2026-09-08", orders: 4, working_days: 1, dpd: 4, dpd_eff: null, tgt_eff: null },
      { bucket: "2026-09-15", orders: 6, working_days: 1, dpd: 6, dpd_eff: null, tgt_eff: null },
      { bucket: "2026-09-22", orders: 2, working_days: 1, dpd: 2, dpd_eff: null, tgt_eff: null },
      { bucket: "2026-09-23", orders: 3, working_days: 1, dpd: 3, dpd_eff: null, tgt_eff: null },
    ];
    const weeks = bucketOpsTrend(sep, "weekly");
    assert.deepEqual(
      weeks.map((w) => w.bucket),
      ["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22"],
    );
    assert.equal(weeks[3]?.orders, 5);
  });

  it("weekly always emits 4 month buckets; missing weeks are 0", () => {
    const sparse = [
      { bucket: "2026-09-01", orders: 10, working_days: 2, dpd: 5, dpd_eff: null, tgt_eff: null },
      { bucket: "2026-09-15", orders: 6, working_days: 1, dpd: 6, dpd_eff: null, tgt_eff: null },
      { bucket: "2026-09-22", orders: 2, working_days: 1, dpd: 2, dpd_eff: null, tgt_eff: null },
    ];
    const weeks = bucketOpsTrend(sparse, "weekly", { from: "2026-09-01", to: "2026-09-23" });
    assert.deepEqual(
      weeks.map((w) => w.bucket),
      ["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22"],
    );
    assert.equal(weeks[1]?.orders, 0);
    assert.equal(weeks[1]?.working_days, 0);
    assert.equal(weeks[1]?.dpd, 0);
    const empty = bucketOpsTrend([], "weekly", { from: "2026-09-01", to: "2026-09-23" });
    assert.deepEqual(
      empty.map((w) => w.bucket),
      ["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22"],
    );
    assert.ok(empty.every((w) => w.orders === 0 && w.dpd === 0));
    assert.deepEqual(bucketOpsTrend([], "weekly"), []);
  });

  it("monthly buckets a year into calendar months", () => {
    const points = [
      { bucket: "2026-01-15", orders: 1, working_days: 1, dpd: 1, dpd_eff: null, tgt_eff: null },
      { bucket: "2026-09-02", orders: 4, working_days: 2, dpd: 2, dpd_eff: null, tgt_eff: null },
    ];
    const months = bucketOpsTrend(points, "monthly");
    assert.deepEqual(
      months.map((m) => m.bucket),
      ["2026-01-01", "2026-09-01"],
    );
    const padded = bucketOpsTrend(points, "monthly", { from: "2026-01-01", to: "2026-09-23" });
    assert.deepEqual(
      padded.map((m) => m.bucket),
      [
        "2026-01-01",
        "2026-02-01",
        "2026-03-01",
        "2026-04-01",
        "2026-05-01",
        "2026-06-01",
        "2026-07-01",
        "2026-08-01",
        "2026-09-01",
      ],
    );
    assert.equal(padded[1]?.orders, 0);
    assert.equal(padded[1]?.dpd, 0);
    assert.equal(formatOpsTrendLabel("2026-09-01", "monthly"), "Sep 2026");
    assert.equal(formatOpsTrendLabel("2026-09-22", "weekly"), "22 Sep");
  });

  it("year options run from first delivery year to today", () => {
    assert.deepEqual(opsYearOptions("2025-06-01", "2026-09-23"), [2025, 2026]);
    assert.deepEqual(opsYearOptions(null, "2026-09-23"), [2026]);
  });

  it("Clear resets the period to This Month", () => {
    assert.equal(DEFAULT_OPS_PRESET, "thisMonth");
    assert.deepEqual(resetOpsPeriod(), {
      preset: "thisMonth",
      customFrom: null,
      customTo: null,
    });
  });

  it("outsource company rows include Unassigned and 0-order riders", () => {
    const rows = companyRowsFromRiders([
      { source_company: null, orders: 0, working_days: 0, dpd_eff: null, tgt_eff: null },
      { source_company: "", orders: 3, working_days: 1, dpd_eff: 80, tgt_eff: 40 },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.key, "unassigned");
    assert.equal(rows[0]?.riders, 2);
    assert.equal(rows[0]?.orders, 3);
    assert.equal(rows[0]?.active_riders, 1);
  });

  it("attachTrendEff mirrors the RPC tgt_eff formula", () => {
    const [row] = attachTrendEff(
      [{ bucket: "2026-09-01", orders: 50, working_days: 2, dpd: 25, dpd_eff: null, tgt_eff: null }],
      20,
      80,
      25,
    );
    assert.equal(row?.tgt_eff, 100);
    assert.equal(row?.dpd_eff, 100);
  });
});

describe("display ID leftovers", () => {
  it("Source tooltip uses stored company, not the code", () => {
    assert.equal(
      sourceLabel({ sourceType: "outsourced", sourceCompany: "brk" }),
      "Outsourced (BRK)",
    );
    assert.equal(
      sourceLabel({ sourceType: "in_house", sourceCompany: "mg" }),
      "In-house (MG)",
    );
  });
});
