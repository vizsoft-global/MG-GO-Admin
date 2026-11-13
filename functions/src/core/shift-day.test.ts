import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SHIFT_TAIL_HOURS,
  dedupeById,
  isDayString,
  kuwaitDayEndMs,
  kuwaitDayOf,
  kuwaitDayStartMs,
  resolveWorkDay,
  scanUpperMs,
} from "./shift-day";

describe("resolveWorkDay", () => {
  it("files a post-midnight order under the shift that started the day before", () => {
    // Shift 15 Nov 13:00 -> 16 Nov 01:00. An order delivered at 16 Nov 00:40
    // carries `shift_date: 2026-11-15` and must be counted on the 15th.
    const deliveredAt = Date.parse("2026-11-16T00:40:00+03:00");
    assert.equal(kuwaitDayOf(deliveredAt), "2026-11-16");
    assert.equal(resolveWorkDay(deliveredAt, "2026-11-15"), "2026-11-15");
  });

  it("keeps a same-day order on its own day", () => {
    const deliveredAt = Date.parse("2026-11-15T20:10:00+03:00");
    assert.equal(resolveWorkDay(deliveredAt, "2026-11-15"), "2026-11-15");
  });

  it("falls back to the calendar day when the row has no shift", () => {
    const deliveredAt = Date.parse("2026-11-16T00:40:00+03:00");
    assert.equal(resolveWorkDay(deliveredAt, null), "2026-11-16");
    assert.equal(resolveWorkDay(deliveredAt, undefined), "2026-11-16");
    assert.equal(resolveWorkDay(deliveredAt, ""), "2026-11-16");
  });

  it("refuses a malformed shift_date rather than trusting it", () => {
    const deliveredAt = Date.parse("2026-11-15T20:10:00+03:00");
    for (const bad of ["15/11/2026", "2026-13-01", "2026-02-30", 20261115, {}]) {
      assert.equal(resolveWorkDay(deliveredAt, bad), "2026-11-15");
    }
  });

  it("returns null when there is neither a shift nor a delivery instant", () => {
    assert.equal(resolveWorkDay(null, null), null);
    assert.equal(resolveWorkDay(Number.NaN, undefined), null);
  });
});

describe("isDayString", () => {
  it("accepts a real calendar day and rejects the near misses", () => {
    assert.equal(isDayString("2026-11-15"), true);
    assert.equal(isDayString("2026-11-15T00:00:00Z"), false);
    assert.equal(isDayString("2026-13-01"), false);
    assert.equal(isDayString(""), false);
    assert.equal(isDayString(null), false);
  });
});

describe("scan window", () => {
  it("reaches far enough past the last day for an overnight shift", () => {
    const toDay = "2026-11-15";
    const lastInstantOfDay = kuwaitDayEndMs(toDay) - 1;
    const afterMidnight = Date.parse("2026-11-16T01:00:00+03:00");
    assert.ok(afterMidnight < scanUpperMs(toDay), "01:00 next day must be inside the scan");
    assert.ok(lastInstantOfDay < scanUpperMs(toDay));
    assert.equal(scanUpperMs(toDay) - kuwaitDayEndMs(toDay), SHIFT_TAIL_HOURS * 3_600_000);
  });

  it("starts a day exactly at Kuwait midnight", () => {
    assert.equal(new Date(kuwaitDayStartMs("2026-11-15")).toISOString(), "2026-11-14T21:00:00.000Z");
  });
});

describe("dedupeById", () => {
  it("collapses the overlap between two scan slices", () => {
    const rows = [
      { id: "a" },
      { id: "b" },
      { id: "a" },
      { id: "c" },
      { id: "b" },
    ];
    assert.deepEqual(
      dedupeById(rows).map((row) => row.id),
      ["a", "b", "c"],
    );
  });

  it("keeps the first occurrence, so order of a chunked scan is stable", () => {
    const rows = [
      { id: "d1", slice: 1 },
      { id: "d1", slice: 2 },
    ];
    assert.equal(dedupeById(rows)[0]?.slice, 1);
  });

  it("is a no-op on a list that has no duplicates", () => {
    const rows = [{ id: "x" }, { id: "y" }];
    assert.equal(dedupeById(rows).length, 2);
  });
});
