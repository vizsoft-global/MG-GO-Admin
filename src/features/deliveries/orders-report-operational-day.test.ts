import assert from "node:assert/strict";
import { test } from "node:test";
import { kuwaitInstant } from "./delivery-shift-date";
import {
  clampAttributedDate,
  exclusiveReportEnd,
  inReportWindow,
  isOperationalDayMode,
  operationalAttributedDate,
  reportColumnRange,
} from "./orders-report-operational-day";

const D = "2026-09-20";
const D1 = "2026-09-21";
const fromMs = kuwaitInstant(D, "05:00:00");
const toMs = kuwaitInstant(D1, "05:00:00");

function wall(date: string, time: string): string {
  return `${date}T${time}`;
}

test("00:00 stays on the shift-attribution path", () => {
  assert.equal(isOperationalDayMode("00:00:00"), false);
  assert.equal(isOperationalDayMode("05:00:00"), true);
});

test("05:00 → next-day 05:00 is exclusive at the end and has one column", () => {
  assert.equal(exclusiveReportEnd("05:00:00", "05:00:00"), true);
  assert.deepEqual(reportColumnRange(D, D1, "05:00:00", "05:00:00"), {
    first: D,
    last: D,
  });
});

const cases: Array<{ time: string; date: string; inWindow: boolean; column: string | null }> = [
  { time: "04:59:00", date: D, inWindow: false, column: null },
  { time: "05:00:00", date: D, inWindow: true, column: D },
  { time: "23:59:00", date: D, inWindow: true, column: D },
  { time: "00:00:00", date: D1, inWindow: true, column: D },
  { time: "02:00:00", date: D1, inWindow: true, column: D },
  { time: "04:59:00", date: D1, inWindow: true, column: D },
  { time: "05:00:00", date: D1, inWindow: false, column: null },
];

for (const row of cases) {
  test(`${row.date} ${row.time} ${row.inWindow ? "stays on" : "leaves"} the 05:00 window`, () => {
    const at = kuwaitInstant(row.date, row.time);
    assert.equal(inReportWindow(at, fromMs, toMs, true), row.inWindow);
    if (row.inWindow) {
      const attributed = operationalAttributedDate(wall(row.date, row.time), "05:00:00");
      const columns = reportColumnRange(D, D1, "05:00:00", "05:00:00");
      assert.equal(clampAttributedDate(attributed, columns.first, columns.last), row.column);
    }
  });
}

test("every in-window probe lands on the previous operational day, never dropped", () => {
  const columns = reportColumnRange(D, D1, "05:00:00", "05:00:00");
  const attributed = cases
    .filter((row) => row.inWindow)
    .map((row) =>
      clampAttributedDate(
        operationalAttributedDate(wall(row.date, row.time), "05:00:00"),
        columns.first,
        columns.last,
      ),
    );
  assert.deepEqual(attributed, [D, D, D, D, D]);
});
