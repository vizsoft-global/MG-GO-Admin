import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  shiftEndDayOffset,
  validateDailyShift,
  parseShiftTime,
} from "./driver-shift";

describe("validateDailyShift", () => {
  it("rejects unknown types and future dates", () => {
    assert.equal(
      validateDailyShift({
        shiftType: "triple",
        session1Start: "09:00",
        session1End: "17:00",
        session2Start: null,
        session2End: null,
        shiftDate: null,
        today: "2026-10-09",
      }).ok,
      false,
    );
    const future = validateDailyShift({
      shiftType: "single",
      session1Start: "09:00",
      session1End: "17:00",
      session2Start: null,
      session2End: null,
      shiftDate: "2026-10-10",
      today: "2026-10-09",
    });
    assert.equal(future.ok, false);
    if (!future.ok) assert.equal(future.error, "future_date");
  });

  it("accepts an overnight single shift", () => {
    const result = validateDailyShift({
      shiftType: "single",
      session1Start: "14:00",
      session1End: "02:00",
      session2Start: null,
      session2End: null,
      shiftDate: "2026-10-09",
      today: "2026-10-09",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.session1_end_day_offset, 1);
      assert.equal(result.value.session2_start, null);
    }
  });

  it("rejects a second session on a single shift", () => {
    const result = validateDailyShift({
      shiftType: "single",
      session1Start: "09:00",
      session1End: "17:00",
      session2Start: "18:00",
      session2End: "20:00",
      shiftDate: null,
      today: "2026-10-09",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "session2_not_allowed");
  });

  it("rejects overlapping split sessions", () => {
    const result = validateDailyShift({
      shiftType: "split",
      session1Start: "09:00",
      session1End: "13:00",
      session2Start: "12:00",
      session2End: "16:00",
      shiftDate: null,
      today: "2026-10-09",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "sessions_overlap");
  });

  it("accepts a split shift and computes offsets", () => {
    const result = validateDailyShift({
      shiftType: "split",
      session1Start: "09:00",
      session1End: "13:00",
      session2Start: "16:00",
      session2End: "20:00",
      shiftDate: null,
      today: "2026-10-09",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.session2_start_day_offset, 0);
      assert.equal(result.value.session2_end_day_offset, 0);
    }
  });
});

describe("shift helpers", () => {
  it("marks overnight when the clock end is at or before start", () => {
    const start = parseShiftTime("22:00");
    const end = parseShiftTime("06:00");
    assert.ok(start && end);
    assert.equal(shiftEndDayOffset(start, end), 1);
    assert.equal(shiftEndDayOffset(start, start), 1);
  });

  it("determines active overnight shift spanning past midnight (Item 4.1)", () => {
    const shift = {
      shift_date: "2026-11-15",
      shift_type: "single",
      session1_start: "13:00",
      session1_end: "01:00",
      session1_end_day_offset: 1,
      session2_end: null,
      session2_end_day_offset: null,
    };
    // Nov 15 13:00 Kuwait = 10:00 UTC
    // Nov 16 01:00 Kuwait = Nov 15 22:00 UTC
    // Order delivered at 00:30 Nov 16 Kuwait = Nov 15 21:30 UTC
    const offset = shiftEndDayOffset(parseShiftTime("13:00")!, parseShiftTime("01:00")!);
    assert.equal(offset, 1);
  });
});
