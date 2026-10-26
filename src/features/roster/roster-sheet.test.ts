import assert from "node:assert/strict";
import test from "node:test";
import { evaluateEarlyDrop } from "./early-drop-eval";
import { rosterDutyStatus } from "./roster-adherence";
import { applyApprovedShift } from "./roster-changes";
import { rosterHours } from "./roster-hours";
import { parseRestaurantZoneSheet, parseRosterSheet } from "./roster-sheet";

const HEADER = ["Driver Id", "Driver Name", "Store CC", "Store Name", "Date", "Day", "Shift no.", "Start Time", "End Time", "Ends Next Day", "OFF", "Notes"];

test("split rows merge and overnight offset follows Ends Next Day", () => {
  const parsed = parseRosterSheet([
    HEADER,
    ["10569", "James", "CC", "KFC ALSHAAB", "2026-10-26", "Monday", 1, "10:00 AM", "4:00 PM", "No", "", ""],
    ["10569", "James", "CC", "KFC ALSHAAB", "2026-10-26", "Monday", 2, "8:00 PM", "2:00 AM", "Yes", "", "covering another branch"],
  ]);
  assert.equal(parsed.headerError, null);
  assert.equal(parsed.drafts.length, 1);
  const draft = parsed.drafts[0];
  assert.equal(draft.shiftType, "split");
  assert.equal(draft.session1Start, "10:00:00");
  assert.equal(draft.session1End, "16:00:00");
  assert.equal(draft.session1EndDayOffset, 0);
  assert.equal(draft.session2Start, "20:00:00");
  assert.equal(draft.session2End, "02:00:00");
  assert.equal(draft.session2EndDayOffset, 1);
  assert.equal(draft.notes, "covering another branch");
  assert.deepEqual(draft.errors, []);
});

test("OFF has no sessions and a work row on the same day is refused", () => {
  const off = parseRosterSheet([HEADER, ["10569", "James", "", "", "2026-10-27", "Tuesday", "", "", "", "", "Yes", ""]]);
  assert.equal(off.drafts[0].off, true);
  assert.equal(off.drafts[0].session1Start, null);
  assert.deepEqual(off.drafts[0].errors, []);

  const both = parseRosterSheet([
    HEADER,
    ["10569", "James", "", "", "2026-10-27", "Tuesday", "", "", "", "", "OFF", ""],
    ["10569", "James", "", "KFC", "2026-10-27", "Tuesday", 1, "10:00", "16:00", "No", "", ""],
  ]);
  assert.ok(both.drafts[0].errors.includes("off_and_work"));
});

test("missing driver and date columns fail the sheet", () => {
  assert.equal(parseRosterSheet([]).headerError, "empty");
  assert.equal(parseRosterSheet([["Notes"]]).headerError, "missing_columns");
});

test("restaurant sheet needs Store and Zone", () => {
  assert.deepEqual(parseRestaurantZoneSheet([["Store Name", "Zone"], ["KFC ALSHAAB", "Capital"]]), [
    { row: 2, store: "KFC ALSHAAB", zone: "Capital" },
  ]);
  assert.deepEqual(parseRestaurantZoneSheet([["Driver Id"]]), []);
});

test("adherence: grace, no-show, early logout, and OFF", () => {
  const start = new Date("2026-10-26T07:00:00Z");
  const end = new Date("2026-10-26T13:00:00Z");
  assert.equal(
    rosterDutyStatus({ off: true, start, end, checkIn: null, checkOut: null, now: end }).status,
    "off",
  );
  assert.equal(
    rosterDutyStatus({ off: false, start, end, checkIn: null, checkOut: null, now: new Date(start.getTime() + 10 * 60_000) }).status,
    "scheduled",
  );
  assert.equal(
    rosterDutyStatus({ off: false, start, end, checkIn: null, checkOut: null, now: new Date(start.getTime() + 16 * 60_000) }).status,
    "not_logged_in",
  );
  assert.equal(
    rosterDutyStatus({ off: false, start, end, checkIn: null, checkOut: null, now: end }).status,
    "no_show",
  );
  const early = rosterDutyStatus({
    off: false,
    start,
    end,
    checkIn: new Date(start.getTime() + 20 * 60_000),
    checkOut: new Date(end.getTime() - 30 * 60_000),
    now: end,
  });
  assert.equal(early.status, "logged_out_early");
  assert.equal(early.minutesLate, 20);
  assert.equal(early.minutesEarly, 30);
  assert.equal(
    rosterDutyStatus({
      off: false,
      start,
      end,
      checkIn: null,
      checkOut: null,
      now: new Date(start.getTime() + 16 * 60_000),
      noLoginGraceMin: 60,
    }).status,
    "scheduled",
  );
  assert.equal(
    rosterDutyStatus({
      off: false,
      start,
      end,
      checkIn: null,
      checkOut: null,
      now: new Date(start.getTime() + 61 * 60_000),
      noLoginGraceMin: 60,
    }).status,
    "not_logged_in",
  );
});

test("worked hours stay inside the scheduled window", () => {
  const start = new Date("2026-10-26T07:00:00Z");
  const end = new Date("2026-10-26T11:00:00Z");
  const hours = rosterHours({
    start,
    end,
    checkIn: new Date(start.getTime() + 30 * 60_000),
    checkOut: new Date("2026-10-26T10:00:00Z"),
    openUntil: null,
  });
  assert.equal(hours.scheduled, 240);
  assert.equal(hours.worked, 150);
});

test("an approved change replaces the uploaded shift", () => {
  const next = applyApprovedShift(
    {
      session1_start: "10:00:00",
      session1_end: "16:00:00",
      restaurant_id: "r1",
      shift_type: "split",
      is_off: false,
    },
    {
      off: false,
      start: "12:00:00",
      end: "18:00:00",
      endsNextDay: false,
      restaurantId: "r2",
      approvedByName: "Ops",
    },
  );
  assert.equal(next.session1_start, "12:00:00");
  assert.equal(next.session1_end, "18:00:00");
  assert.equal(next.restaurant_id, "r2");
  assert.equal(next.shift_type, "single");
});

test("early drop is the example delivery: 0 m, 1 minute, no pickup proof", () => {
  const verdict = evaluateEarlyDrop({
    pickupToDropMeters: 0,
    restaurantToDropMeters: null,
    durationMinutes: 1,
    missingPickupProof: true,
    customerToDropMeters: null,
  });
  assert.equal(verdict.early, true);
  assert.ok(verdict.reasons.includes("near_restaurant"));
  assert.ok(verdict.reasons.includes("short_duration"));
  assert.ok(verdict.reasons.includes("missing_proof"));
  const clean = evaluateEarlyDrop({
    pickupToDropMeters: 800,
    restaurantToDropMeters: 800,
    durationMinutes: 20,
    missingPickupProof: false,
    customerToDropMeters: null,
  });
  assert.equal(clean.early, false);
});
