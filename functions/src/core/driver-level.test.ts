import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DRIVER_LEVEL_D,
  DRIVER_LEVEL_FALLBACK_TARGET,
  DRIVER_LEVEL_MIN_ACTIVE_DAYS,
  DRIVER_LEVEL_STANDARD,
  driverLevelDaysElapsed,
  driverLevelWindow,
  effectiveDriverLevel,
  parseDriverLevelKey,
  resolveDriverLevel,
} from "./driver-level";

const MONTH = "2026-10";

describe("driver level window", () => {
  it("stops the window at today when the month is still running", () => {
    assert.deepEqual(driverLevelWindow(MONTH, "2026-10-18"), {
      from: "2026-10-01",
      to: "2026-10-18",
    });
  });

  it("closes the window at the last day of a finished month", () => {
    assert.deepEqual(driverLevelWindow("2026-09", "2026-10-18"), {
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });

  it("handles a leap February", () => {
    assert.deepEqual(driverLevelWindow("2028-02", "2028-03-05"), {
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });

  it("returns an empty window for a month that has not started", () => {
    assert.deepEqual(driverLevelWindow("2026-12", "2026-10-18"), {
      from: "2026-12-01",
      to: "",
    });
    assert.equal(driverLevelDaysElapsed("2026-12-01", ""), 0);
  });

  it("counts both ends of the elapsed window", () => {
    assert.equal(driverLevelDaysElapsed("2026-10-01", "2026-10-01"), 1);
    assert.equal(driverLevelDaysElapsed("2026-10-01", "2026-10-18"), 18);
  });
});

describe("driver level verdict", () => {
  it("marks a rider D when verified orders trail their worked days", () => {
    const verdict = resolveDriverLevel({
      month: MONTH,
      activeDays: 10,
      verifiedDeliveries: 180,
      targetDpd: 20,
    });
    assert.equal(verdict.level, DRIVER_LEVEL_D);
    assert.equal(verdict.metrics.required_orders, 200);
    assert.equal(verdict.metrics.gap, 20);
    assert.equal(verdict.metrics.dpd, 18);
  });

  it("keeps a rider standard when the target is met exactly", () => {
    const verdict = resolveDriverLevel({
      month: MONTH,
      activeDays: 10,
      verifiedDeliveries: 200,
      targetDpd: 20,
    });
    assert.equal(verdict.level, DRIVER_LEVEL_STANDARD);
    assert.equal(verdict.metrics.gap, 0);
  });

  it("keeps a rider standard when they are ahead of target", () => {
    const verdict = resolveDriverLevel({
      month: MONTH,
      activeDays: 10,
      verifiedDeliveries: 260,
      targetDpd: 20,
    });
    assert.equal(verdict.level, DRIVER_LEVEL_STANDARD);
    assert.ok(verdict.metrics.gap < 0);
  });

  /**
   * The floor is the whole reason the first days of a month do not paint the
   * fleet red: one worked day with one order is a deficit by arithmetic and a
   * rider with no history by any useful reading.
   */
  it("does not classify a rider below the minimum worked days", () => {
    for (let days = 0; days < DRIVER_LEVEL_MIN_ACTIVE_DAYS; days += 1) {
      const verdict = resolveDriverLevel({
        month: MONTH,
        activeDays: days,
        verifiedDeliveries: 0,
        targetDpd: 20,
      });
      assert.equal(verdict.level, DRIVER_LEVEL_STANDARD, `days=${days}`);
      // The shortfall still rides along so a panel can show it without acting.
      if (days > 0) assert.ok(verdict.metrics.gap > 0, `days=${days}`);
    }

    const atFloor = resolveDriverLevel({
      month: MONTH,
      activeDays: DRIVER_LEVEL_MIN_ACTIVE_DAYS,
      verifiedDeliveries: 0,
      targetDpd: 20,
    });
    assert.equal(atFloor.level, DRIVER_LEVEL_D);
  });

  /**
   * A settings row with no target is a bad row, not a zero target. Zero would
   * mean "required nothing", marking the entire fleet standard on a data
   * mistake — the one failure this classification must not have.
   */
  it("falls back to the default target when the resolved one is not a target", () => {
    for (const target of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const verdict = resolveDriverLevel({
        month: MONTH,
        activeDays: 10,
        verifiedDeliveries: 0,
        targetDpd: target,
      });
      assert.equal(verdict.metrics.target_dpd, DRIVER_LEVEL_FALLBACK_TARGET);
      assert.equal(verdict.level, DRIVER_LEVEL_D);
    }
  });

  it("reports a null DPD rather than dividing by zero", () => {
    const verdict = resolveDriverLevel({
      month: MONTH,
      activeDays: 0,
      verifiedDeliveries: 0,
      targetDpd: 20,
    });
    assert.equal(verdict.metrics.dpd, null);
    assert.equal(verdict.metrics.required_orders, 0);
  });

  it("rounds metrics to two places so the panel and the sweep agree", () => {
    const verdict = resolveDriverLevel({
      month: MONTH,
      activeDays: 3,
      verifiedDeliveries: 50,
      targetDpd: 17.5,
    });
    assert.equal(verdict.metrics.required_orders, 52.5);
    assert.equal(verdict.metrics.gap, 2.5);
    assert.equal(verdict.metrics.dpd, 16.67);
  });

  it("treats negative counts as zero rather than crediting them", () => {
    const verdict = resolveDriverLevel({
      month: MONTH,
      activeDays: -4,
      verifiedDeliveries: -10,
      targetDpd: 20,
    });
    assert.equal(verdict.metrics.active_days, 0);
    assert.equal(verdict.metrics.mtd_verified_deliveries, 0);
    assert.equal(verdict.metrics.dpd, null);
  });

  it("carries the elapsed-day count so a partial month is distinguishable", () => {
    const verdict = resolveDriverLevel({
      month: MONTH,
      activeDays: 10,
      verifiedDeliveries: 150,
      targetDpd: 20,
      daysElapsed: 18,
    });
    assert.equal(verdict.metrics.days_elapsed, 18);
  });
});

describe("effective level", () => {
  it("prints the automatic verdict when nobody has overridden", () => {
    assert.equal(effectiveDriverLevel(DRIVER_LEVEL_D, null), DRIVER_LEVEL_D);
    assert.equal(effectiveDriverLevel(DRIVER_LEVEL_STANDARD, null), DRIVER_LEVEL_STANDARD);
  });

  /**
   * An override has to be able to go both ways: withholding D from a rider
   * whose numbers say otherwise, and marking one D before the maths would.
   */
  it("lets an override clear a D the maths produced", () => {
    assert.equal(effectiveDriverLevel(DRIVER_LEVEL_D, DRIVER_LEVEL_STANDARD), DRIVER_LEVEL_STANDARD);
  });

  it("lets an override apply a D the maths did not produce", () => {
    assert.equal(effectiveDriverLevel(DRIVER_LEVEL_STANDARD, DRIVER_LEVEL_D), DRIVER_LEVEL_D);
  });

  it("treats an unknown stored override as no override", () => {
    assert.equal(effectiveDriverLevel(DRIVER_LEVEL_D, "level_d"), DRIVER_LEVEL_D);
    assert.equal(effectiveDriverLevel(DRIVER_LEVEL_STANDARD, "x"), DRIVER_LEVEL_STANDARD);
  });

  it("defaults a missing automatic verdict to standard", () => {
    assert.equal(effectiveDriverLevel(undefined, null), DRIVER_LEVEL_STANDARD);
    assert.equal(effectiveDriverLevel("", null), DRIVER_LEVEL_STANDARD);
  });
});

describe("level key parsing", () => {
  it("reads only the two stored keys", () => {
    assert.equal(parseDriverLevelKey("D"), "D");
    assert.equal(parseDriverLevelKey("standard"), "standard");
    assert.equal(parseDriverLevelKey("d"), null);
    assert.equal(parseDriverLevelKey(""), null);
    assert.equal(parseDriverLevelKey(null), null);
    assert.equal(parseDriverLevelKey(undefined), null);
  });
});
