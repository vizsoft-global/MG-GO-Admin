import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeClock,
  slotMatchesDate,
  timesOverlap,
  visitAvailabilityBlock,
  visitAvailabilityMessage,
} from "./driver-visits";

describe("timesOverlap", () => {
  it("detects overlapping clocks the way SQL does", () => {
    assert.equal(timesOverlap("09:00:00", "10:00:00", "09:30:00", "10:30:00"), true);
    assert.equal(timesOverlap("09:00", "10:00", "10:00", "11:00"), false);
    assert.equal(timesOverlap("11:00:00", "12:00:00", "09:00:00", "10:00:00"), false);
  });
});

describe("normalizeClock", () => {
  it("pads HH:MM to HH:MM:SS", () => {
    assert.equal(normalizeClock("9:00"), "09:00:00");
  });
});

describe("visitAvailabilityBlock", () => {
  const today = "2026-10-09";

  it("returns null when no branch is resolved", () => {
    assert.equal(
      visitAvailabilityBlock({
        branch: null,
        branchId: null,
        day: "2026-10-10",
        today,
        blockedDates: [],
      }),
      null,
    );
  });

  it("names the SQL codes", () => {
    assert.equal(
      visitAvailabilityBlock({
        branch: { is_active: false },
        branchId: "b1",
        day: "2026-10-10",
        today,
        blockedDates: [],
      }),
      "branch_inactive",
    );
    assert.equal(
      visitAvailabilityBlock({
        branch: { is_active: true, working_dows: [0, 1, 2, 3, 4] },
        branchId: "b1",
        day: "2026-10-09",
        today,
        blockedDates: [],
      }),
      "branch_closed",
    );
    assert.equal(
      visitAvailabilityBlock({
        branch: { is_active: true, working_dows: [] },
        branchId: "b1",
        day: "2026-10-10",
        today,
        blockedDates: [{ day: "2026-10-10", branchId: null }],
      }),
      "date_blocked",
    );
    assert.equal(
      visitAvailabilityBlock({
        branch: { is_active: true, working_dows: [], booking_window_days: 2 },
        branchId: "b1",
        day: "2026-10-20",
        today,
        blockedDates: [],
      }),
      "outside_booking_window",
    );
  });
});

describe("visitAvailabilityMessage", () => {
  it("keeps the SQL rider-facing sentences", () => {
    assert.equal(
      visitAvailabilityMessage("overlapping_visit"),
      "This date is not available for booking.",
    );
    assert.equal(
      visitAvailabilityMessage("department_not_at_branch") !== "",
      true,
    );
    assert.match(visitAvailabilityMessage("branch_closed"), /closed/);
  });
});

describe("slotMatchesDate", () => {
  it("matches a dated slot or the weekday template", () => {
    assert.equal(slotMatchesDate({ slot_date: "2026-10-09", day_of_week: 1 }, "2026-10-09"), true);
    assert.equal(slotMatchesDate({ slot_date: null, day_of_week: 5 }, "2026-10-09"), true);
    assert.equal(slotMatchesDate({ slot_date: null, day_of_week: 1 }, "2026-10-09"), false);
  });
});
