import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appAttendanceTotals, appHoursForDay } from "./payroll-rider-columns";
import type { PayrollRiderRow } from "./payroll-types";

/**
 * `appHours` is the server's display-only figure: the attendance span split at
 * Kuwait midnight and clipped to the rider's shift. These cases pin the four
 * things the previous expression got wrong or would get wrong if the fallback
 * were written carelessly.
 */
function rowOf(days: Array<{ appHours?: number; loggedHours?: number; elapsedHours?: number }>) {
  return {
    dayInfo: days.map((day, index) => ({ date: `2026-11-0${index + 1}`, ...day })),
  } as unknown as PayrollRiderRow;
}

describe("appHoursForDay", () => {
  it("prints the clipped figure instead of the raw clock-in span", () => {
    // The reported case: 08:00 → 07:00 next day read 23 h before the clipping.
    const row = rowOf([{ appHours: 12, loggedHours: 16 }]);
    assert.equal(appHoursForDay(row, 0), 12);
  });

  it("keeps the attendance figure when the server sent no clipped value", () => {
    // An older deploy, or the local table fallback: degrade, do not blank.
    const row = rowOf([{ loggedHours: 9.5 }]);
    assert.equal(appHoursForDay(row, 0), 9.5);
  });

  it("treats a clipped zero as real work outside the rota, not as missing", () => {
    // Falling back to `loggedHours` here would undo the whole point of the clip.
    const row = rowOf([{ appHours: 0, loggedHours: 18 }]);
    assert.equal(appHoursForDay(row, 0), 0);
  });

  it("still shows elapsed hours on an open shift today", () => {
    // The server cannot measure a shift with no end, so its clipped figure is 0
    // and the elapsed reading is the only honest one.
    const row = rowOf([{ appHours: 0, loggedHours: 0, elapsedHours: 4.5 }]);
    assert.equal(appHoursForDay(row, 0), 4.5);
  });

  it("returns zero for a day with no info at all", () => {
    const row = rowOf([]);
    assert.equal(appHoursForDay(row, 0), 0);
  });

  it("holds the raw fallback to one working day", () => {
    // The production report: a rider whose log was closed by the midnight
    // auto-checkout read 23.06 h because the snapshot carried no clipped
    // figure at all. The tab must never print more than a working day.
    assert.equal(appHoursForDay(rowOf([{ loggedHours: 23.06 }]), 0), 12);
    assert.equal(appHoursForDay(rowOf([{ appHours: 0, loggedHours: 0, elapsedHours: 14.8 }]), 0), 12);
  });

  it("leaves an honest figure below the cap alone", () => {
    assert.equal(appHoursForDay(rowOf([{ loggedHours: 7.25 }]), 0), 7.25);
    assert.equal(appHoursForDay(rowOf([{ appHours: 10 }]), 0), 10);
  });
});

describe("appAttendanceTotals", () => {
  it("sums the clipped figures and counts only days with usage", () => {
    const row = rowOf([
      { appHours: 12, loggedHours: 16 },
      { appHours: 0, loggedHours: 18 },
      { appHours: 8 },
      { loggedHours: 6 },
    ]);
    const totals = appAttendanceTotals(row);
    assert.equal(totals.totalHours, 26);
    assert.equal(totals.activeDays, 3);
    assert.equal(totals.avgHours, 26 / 3);
  });

  it("never exceeds a day with a full shift and a clean clock-out", () => {
    const row = rowOf(Array.from({ length: 10 }, () => ({ appHours: 12, loggedHours: 12 })));
    assert.equal(appAttendanceTotals(row).avgHours, 12);
  });
});
