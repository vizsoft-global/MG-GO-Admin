import assert from "node:assert/strict";
import { test } from "node:test";
import {
  currentOperationalDayYmd,
  operationalDayBounds,
  operationalDayEndIso,
  operationalDayStartIso,
  operationalDayWindowBounds,
} from "./operational-day";

test("an operational day runs 06:00 to 05:59:59.999 the next day", () => {
  assert.deepEqual(operationalDayBounds("2026-09-30"), {
    from: "2026-09-30T06:00:00.000+03:00",
    to: "2026-10-01T05:59:59.999+03:00",
  });
  assert.equal(operationalDayStartIso("2026-09-30"), "2026-09-30T06:00:00.000+03:00");
  assert.equal(operationalDayEndIso("2026-09-30"), "2026-10-01T05:59:59.999+03:00");
});

test("a month window spans from the first day's 06:00 to the last day's 05:59", () => {
  assert.deepEqual(operationalDayWindowBounds("2026-09-01", "2026-09-30"), {
    from: "2026-09-01T06:00:00.000+03:00",
    to: "2026-10-01T05:59:59.999+03:00",
  });
});

const dayCases: Array<{ at: string; expected: string; why: string }> = [
  {
    at: "2026-09-30T03:00:00+03:00",
    expected: "2026-09-29",
    why: "03:00 Kuwait is still the previous operational day",
  },
  {
    at: "2026-09-30T05:59:59+03:00",
    expected: "2026-09-29",
    why: "one second before the rollover still belongs to the previous day",
  },
  {
    at: "2026-09-30T06:00:00+03:00",
    expected: "2026-09-30",
    why: "06:00 opens its own operational day",
  },
  {
    at: "2026-09-30T23:30:00+03:00",
    expected: "2026-09-30",
    why: "late evening is the same operational day",
  },
  {
    at: "2026-10-01T02:01:00+03:00",
    expected: "2026-09-30",
    why: "a 02:01 fix is the same operational day as the evening before",
  },
  {
    at: "2026-10-01T05:59:59.999+03:00",
    expected: "2026-09-30",
    why: "the inclusive end still closes the previous operational day",
  },
  {
    at: "2026-10-01T06:00:00+03:00",
    expected: "2026-10-01",
    why: "06:00 starts the next operational day",
  },
];

for (const row of dayCases) {
  test(`${row.at} -> ${row.expected} (${row.why})`, () => {
    assert.equal(currentOperationalDayYmd(new Date(row.at)), row.expected);
  });
}
