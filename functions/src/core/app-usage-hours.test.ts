import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { kuwaitDayStart } from "./kuwait";
import {
  MAX_DAY_HOURS,
  addShiftWindow,
  appUsageHoursByDay,
  clockSecondsOf,
  intersectMs,
  shiftSessionWindow,
  splitSpanByDay,
  unionMs,
  previousKuwaitDay,
  type InstantSpan,
  type ShiftWindowsByDriver,
} from "./app-usage-hours";

/** A Kuwait wall-clock instant on `day`, e.g. `at("2026-11-04", 22, 0)`. */
function at(day: string, hour: number, minute = 0): number {
  return kuwaitDayStart(day).getTime() + (hour * 60 + minute) * 60_000;
}

function windows(): ShiftWindowsByDriver {
  return new Map();
}

describe("splitSpanByDay", () => {
  it("keeps a same-day span whole", () => {
    const pieces = splitSpanByDay({ startMs: at("2026-11-04", 8), endMs: at("2026-11-04", 20) });
    assert.deepEqual(
      pieces.map((piece) => [piece.day, (piece.endMs - piece.startMs) / 3_600_000]),
      [["2026-11-04", 12]],
    );
  });

  it("cuts an overnight span at midnight", () => {
    // The reported case: 08:00 one morning to 07:00 the next is 16 h + 7 h, not 23 h.
    const pieces = splitSpanByDay({ startMs: at("2026-11-03", 8), endMs: at("2026-11-04", 7) });
    assert.deepEqual(
      pieces.map((piece) => [piece.day, (piece.endMs - piece.startMs) / 3_600_000]),
      [
        ["2026-11-03", 16],
        ["2026-11-04", 7],
      ],
    );
  });

  it("cuts a night shift into the two days it belongs to", () => {
    const pieces = splitSpanByDay({ startMs: at("2026-11-04", 22), endMs: at("2026-11-05", 6) });
    assert.deepEqual(
      pieces.map((piece) => [piece.day, (piece.endMs - piece.startMs) / 3_600_000]),
      [
        ["2026-11-04", 2],
        ["2026-11-05", 6],
      ],
    );
  });

  it("ignores a reversed or zero span", () => {
    assert.deepEqual(splitSpanByDay({ startMs: at("2026-11-04", 8), endMs: at("2026-11-04", 8) }), []);
    assert.deepEqual(splitSpanByDay({ startMs: at("2026-11-04", 8), endMs: at("2026-11-04", 7) }), []);
  });
});

describe("unionMs and intersectMs", () => {
  it("counts an overlap once", () => {
    const hours = unionMs([
      { startMs: at("2026-11-04", 8), endMs: at("2026-11-04", 14) },
      { startMs: at("2026-11-04", 12), endMs: at("2026-11-04", 18) },
    ]);
    assert.equal(hours / 3_600_000, 10);
  });

  it("keeps both halves of a split shift apart", () => {
    const hours = unionMs([
      { startMs: at("2026-11-04", 6), endMs: at("2026-11-04", 10) },
      { startMs: at("2026-11-04", 16), endMs: at("2026-11-04", 20) },
    ]);
    assert.equal(hours / 3_600_000, 8);
  });

  it("intersects two sets", () => {
    const over = intersectMs(
      [{ startMs: at("2026-11-04", 8), endMs: at("2026-11-04", 20) }],
      [{ startMs: at("2026-11-04", 18), endMs: at("2026-11-04", 23) }],
    );
    assert.equal(unionMs(over) / 3_600_000, 2);
  });
});

describe("appUsageHoursByDay", () => {
  const driver = "d1";

  it("caps a forgotten clock-out at the shift end, not at 24 h", () => {
    // 08:00 → 07:00 next day outside a 08:00–20:00 shift reads 12 h.
    const spans = new Map([[driver, [{ startMs: at("2026-11-03", 8), endMs: at("2026-11-04", 7) }]]]);
    const w = windows();
    addShiftWindow(w, driver, { startMs: at("2026-11-03", 8), endMs: at("2026-11-03", 20) });
    addShiftWindow(w, driver, { startMs: at("2026-11-04", 8), endMs: at("2026-11-04", 20) });

    const hours = appUsageHoursByDay({ spansByDriver: spans, windows: w });
    assert.equal(hours.get(`${driver}|2026-11-03`), 12);
    // 00:00–07:00 on the 4th sits before that day's shift, so it is not work.
    assert.equal(hours.get(`${driver}|2026-11-04`), 0);
  });

  it("keeps a night shift in both days inside its window", () => {
    const spans = new Map([[driver, [{ startMs: at("2026-11-04", 22), endMs: at("2026-11-05", 6) }]]]);
    const w = windows();
    addShiftWindow(w, driver, { startMs: at("2026-11-04", 22), endMs: at("2026-11-05", 6) });

    const hours = appUsageHoursByDay({ spansByDriver: spans, windows: w });
    assert.equal(hours.get(`${driver}|2026-11-04`), 2);
    assert.equal(hours.get(`${driver}|2026-11-05`), 6);
  });

  it("caps a day with no shift row at one working day", () => {
    // No rota to measure against. The midnight split allows 16 h here, but a
    // day nothing measured is not evidence of a 16-hour shift, and the tab
    // reported exactly this as a forgotten clock-out.
    const spans = new Map([[driver, [{ startMs: at("2026-11-03", 8), endMs: at("2026-11-04", 7) }]]]);
    const hours = appUsageHoursByDay({ spansByDriver: spans, windows: windows() });
    assert.equal(hours.get(`${driver}|2026-11-03`), 12);
    assert.equal(hours.get(`${driver}|2026-11-04`), 7);
  });

  it("counts an overlapping split shift once", () => {
    const spans = new Map([[driver, [{ startMs: at("2026-11-04", 6), endMs: at("2026-11-04", 20) }]]]);
    const w = windows();
    addShiftWindow(w, driver, { startMs: at("2026-11-04", 6), endMs: at("2026-11-04", 14) });
    addShiftWindow(w, driver, { startMs: at("2026-11-04", 13), endMs: at("2026-11-04", 20) });

    // 06–14 plus 13–20 is 06–20 = 14 h, not 15 — then held to one working day.
    const hours = appUsageHoursByDay({ spansByDriver: spans, windows: w });
    assert.equal(hours.get(`${driver}|2026-11-04`), 12);
  });

  it("sums two separate sessions on the same day", () => {
    const spans = new Map([
      [
        driver,
        [
          { startMs: at("2026-11-04", 8), endMs: at("2026-11-04", 11) },
          { startMs: at("2026-11-04", 16), endMs: at("2026-11-04", 19) },
        ],
      ],
    ]);
    const hours = appUsageHoursByDay({ spansByDriver: spans, windows: windows() });
    assert.equal(hours.get(`${driver}|2026-11-04`), 6);
  });

  it("reports zero for a rider who only opened the app outside the rota", () => {
    const spans = new Map([[driver, [{ startMs: at("2026-11-04", 2), endMs: at("2026-11-04", 4) }]]]);
    const w = windows();
    addShiftWindow(w, driver, { startMs: at("2026-11-04", 10), endMs: at("2026-11-04", 22) });

    const hours = appUsageHoursByDay({ spansByDriver: spans, windows: w });
    assert.equal(hours.get(`${driver}|2026-11-04`), 0);
  });

  it("never reports more than a working day holds", () => {
    const span: InstantSpan = { startMs: at("2026-11-03", 8), endMs: at("2026-11-04", 7) };
    const hours = appUsageHoursByDay({
      spansByDriver: new Map([[driver, [span]]]),
      windows: windows(),
    });
    for (const value of hours.values()) {
      assert.ok(value <= MAX_DAY_HOURS, `got ${value}`);
    }
  });
});

describe("shiftSessionWindow", () => {
  // The shape the fleet actually holds: a wall clock plus an end-of-day offset
  // and no instant fields at all.
  const riderRow = {
    shiftDate: "2026-11-01",
    start: "17:00:00",
    end: "05:00:00",
    startDayOffset: 0,
    endDayOffset: 1,
  };

  it("builds an overnight window from the wall clock", () => {
    const window = shiftSessionWindow(riderRow);
    assert.ok(window);
    assert.equal(window.startMs, at("2026-11-01", 17));
    assert.equal(window.endMs, at("2026-11-02", 5));
  });

  it("infers the next day when an overnight row omits the offset", () => {
    const window = shiftSessionWindow({ ...riderRow, endDayOffset: null });
    assert.ok(window);
    assert.equal(window.endMs, at("2026-11-02", 5));
  });

  it("builds a same-day window", () => {
    const window = shiftSessionWindow({
      shiftDate: "2026-11-01",
      start: "10:00",
      end: "16:00",
      endDayOffset: 0,
    });
    assert.ok(window);
    assert.equal(window.startMs, at("2026-11-01", 10));
    assert.equal(window.endMs, at("2026-11-01", 16));
  });

  it("prefers a stamped instant pair when one exists", () => {
    const window = shiftSessionWindow({
      ...riderRow,
      startAt: new Date(at("2026-11-01", 17)),
      endAt: new Date(at("2026-11-02", 5)),
    });
    assert.ok(window);
    assert.equal(window.startMs, at("2026-11-01", 17));
    assert.equal(window.endMs, at("2026-11-02", 5));
  });

  it("returns null when the clocks are missing", () => {
    assert.equal(shiftSessionWindow({ shiftDate: "2026-11-01", start: null, end: null }), null);
    assert.equal(shiftSessionWindow({ ...riderRow, end: "not a clock" }), null);
  });

  it("reads HH:mm and HH:mm:ss alike", () => {
    assert.equal(clockSecondsOf("17:00"), 17 * 3600);
    assert.equal(clockSecondsOf("17:00:00"), 17 * 3600);
    assert.equal(clockSecondsOf("00:30:15"), 30 * 60 + 15);
    assert.equal(clockSecondsOf("24:00"), 24 * 3600);
    assert.equal(clockSecondsOf("24:30"), null);
    assert.equal(clockSecondsOf(17), null);
  });
});

describe("previousKuwaitDay", () => {
  it("steps back one Kuwait calendar day", () => {
    assert.equal(previousKuwaitDay("2026-11-01"), "2026-10-31");
    assert.equal(previousKuwaitDay("2026-03-01"), "2026-02-28");
  });
});
