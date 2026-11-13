import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_USAGE_RATES,
  forecastMonthly,
  functionShape,
  perDayAtRate,
  rebucket,
  sanitizeRates,
  windowTotal,
  windowTotals,
  type UsagePoint,
  type WindowUsage,
} from "./usage-forecast";

const HOUR = 3_600_000;
const END = Date.parse("2026-11-13T12:00:00.000Z");

/** One bucket every five minutes for 24h, each worth `value`. */
function flat(value: number): UsagePoint[] {
  const points: UsagePoint[] = [];
  for (let index = 0; index < 288; index += 1) {
    points.push({ t: END - index * 300_000, v: value });
  }
  return points;
}

const NO_USAGE: WindowUsage = {
  reads: 0,
  writes: 0,
  deletes: 0,
  ttlDeletes: 0,
  invocations: 0,
  vcpuSeconds: 0,
  gibSeconds: 0,
};

describe("usage windows", () => {
  it("sums only the buckets that ended inside the window", () => {
    const points = flat(100);
    assert.equal(windowTotal(points, END, 1), 1_200, "twelve five-minute buckets");
    assert.equal(windowTotal(points, END, 5), 6_000);
    assert.equal(windowTotal(points, END, 24), 28_800);
  });

  it("leaves out a bucket that ended exactly at the window start or after its end", () => {
    const points: UsagePoint[] = [
      { t: END - HOUR, v: 7 },
      { t: END - HOUR + 1, v: 11 },
      { t: END + 1, v: 13 },
    ];
    assert.equal(windowTotal(points, END, 1), 11);
  });

  it("reports all three windows at once", () => {
    assert.deepEqual(windowTotals(flat(10), END), { h1: 120, h5: 600, h24: 2_880 });
  });

  it("stretches a window to a day at the same rate", () => {
    assert.equal(perDayAtRate(1_000, 1), 24_000);
    assert.equal(perDayAtRate(5_000, 5), 24_000);
    assert.equal(perDayAtRate(24_000, 24), 24_000);
    assert.equal(perDayAtRate(10, 0), 0, "no window, no rate");
  });
});

describe("monthly forecast", () => {
  it("is free while the day stays inside Firestore's daily quota", () => {
    const forecast = forecastMonthly(
      { ...NO_USAGE, reads: 50_000, writes: 20_000, deletes: 20_000 },
      24,
      DEFAULT_USAGE_RATES,
    );
    assert.equal(forecast.total, 0);
  });

  it("prices reads above the quota per 100k, thirty days a month", () => {
    // 1,050,000 reads a day -> 1,000,000 paid -> 10 x $0.06 = $0.60 a day.
    const forecast = forecastMonthly({ ...NO_USAGE, reads: 1_050_000 }, 24, DEFAULT_USAGE_RATES);
    assert.ok(Math.abs(forecast.reads - 18) < 1e-9);
    assert.ok(Math.abs(forecast.total - 18) < 1e-9);
  });

  it("gives the same answer for the same hourly rate seen through any window", () => {
    const perHour = 100_000;
    const one = forecastMonthly({ ...NO_USAGE, reads: perHour }, 1, DEFAULT_USAGE_RATES);
    const five = forecastMonthly({ ...NO_USAGE, reads: perHour * 5 }, 5, DEFAULT_USAGE_RATES);
    const day = forecastMonthly({ ...NO_USAGE, reads: perHour * 24 }, 24, DEFAULT_USAGE_RATES);
    assert.ok(Math.abs(one.total - five.total) < 1e-9);
    assert.ok(Math.abs(five.total - day.total) < 1e-9);
  });

  it("bills TTL deletions without the free quota", () => {
    const forecast = forecastMonthly({ ...NO_USAGE, ttlDeletes: 100_000 }, 24, DEFAULT_USAGE_RATES);
    assert.ok(Math.abs(forecast.deletes - 0.02 * 30) < 1e-9);
  });

  it("takes the functions free tier off the month, not the day", () => {
    // 100,000 calls a day is 3M a month: 1M paid at $0.40 per million.
    const forecast = forecastMonthly({ ...NO_USAGE, invocations: 100_000 }, 24, DEFAULT_USAGE_RATES);
    assert.ok(Math.abs(forecast.invocations - 0.4) < 1e-9);

    const small = forecastMonthly({ ...NO_USAGE, invocations: 60_000 }, 24, DEFAULT_USAGE_RATES);
    assert.equal(small.invocations, 0, "1.8M a month is inside the free tier");
  });

  it("prices compute seconds beyond the monthly free tier", () => {
    // One always-on vCPU: 86,400 s a day, 2,592,000 a month, 2,412,000 paid.
    const forecast = forecastMonthly({ ...NO_USAGE, vcpuSeconds: 86_400 }, 24, DEFAULT_USAGE_RATES);
    assert.ok(Math.abs(forecast.compute - 2_412_000 * 0.000024) < 1e-6);
  });
});

describe("rates", () => {
  it("falls back to the defaults for anything that is not a usable number", () => {
    const rates = sanitizeRates({ readsPer100k: "0.03", writesPer100k: -1, junk: 9 });
    assert.equal(rates.readsPer100k, 0.03);
    assert.equal(rates.writesPer100k, DEFAULT_USAGE_RATES.writesPer100k);
    assert.equal("junk" in rates, false);
    assert.deepEqual(sanitizeRates(null), DEFAULT_USAGE_RATES);
  });
});

describe("function shapes", () => {
  it("knows the lanes and worker doors and defaults the rest", () => {
    assert.deepEqual(functionShape("adminapi"), { cpu: 1, memGib: 2 });
    assert.deepEqual(functionShape("adminApiScan"), { cpu: 1, memGib: 4 });
    assert.deepEqual(functionShape("workerfleetread"), { cpu: 1, memGib: 0.25 });
    assert.deepEqual(functionShape("driverheartbeat"), { cpu: 0.08, memGib: 0.25 });
  });
});

describe("chart buckets", () => {
  it("folds five-minute buckets into fifteen-minute ones without losing any", () => {
    const wide = rebucket(flat(10), END, 900_000, 96);
    assert.equal(wide.length, 96);
    assert.equal(wide[95]!.t, END, "the last bucket ends at the window end");
    assert.ok(wide.every((point) => point.v === 30));
    assert.equal(
      wide.reduce((sum, point) => sum + point.v, 0),
      2_880,
    );
  });

  it("ignores points outside the charted window", () => {
    const wide = rebucket([{ t: END - 25 * HOUR, v: 5 }, { t: END + 1, v: 5 }], END, 900_000, 96);
    assert.equal(
      wide.reduce((sum, point) => sum + point.v, 0),
      0,
    );
  });
});
