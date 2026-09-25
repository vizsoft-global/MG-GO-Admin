import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attributeShiftDate,
  candidateShiftDates,
  kuwaitDateKey,
  kuwaitInstant,
  type ShiftWindow,
} from "./delivery-shift-date";

const D = "2026-09-20";
const D1 = "2026-09-21";

function overnight(): ShiftWindow {
  return {
    shiftDate: D,
    startMs: kuwaitInstant(D, "18:00:00", 0),
    endMs: kuwaitInstant(D, "02:00:00", 1),
    sessionNo: 1,
  };
}

test("candidate windows are only the previous and current Kuwait day", () => {
  assert.deepEqual(candidateShiftDates(D1), [D, D1]);
});

test("before midnight stays on the overnight shift date", () => {
  const at = kuwaitInstant(D, "23:30:00");
  assert.equal(kuwaitDateKey(at), D);
  assert.equal(attributeShiftDate(at, D, [overnight()]), D);
});

test("after midnight stays on the overnight shift date", () => {
  const at = kuwaitInstant(D1, "01:30:00");
  assert.equal(kuwaitDateKey(at), D1);
  assert.equal(attributeShiftDate(at, D1, [overnight()]), D);
});

test("exact shift end is not in-window; previous still matches if no next shift", () => {
  const at = kuwaitInstant(D1, "02:00:00");
  assert.equal(attributeShiftDate(at, D1, [overnight()]), D);
});

test("exact shift end belongs to the next shift that starts then", () => {
  const next: ShiftWindow = {
    shiftDate: D1,
    startMs: kuwaitInstant(D1, "02:00:00"),
    endMs: kuwaitInstant(D1, "10:00:00"),
    sessionNo: 1,
  };
  const at = kuwaitInstant(D1, "02:00:00");
  assert.equal(attributeShiftDate(at, D1, [overnight(), next]), D1);
});

test("exact shift start is in-window", () => {
  const at = kuwaitInstant(D, "18:00:00");
  assert.equal(attributeShiftDate(at, D, [overnight()]), D);
});

test("no matching shift falls back to the Kuwait calendar date", () => {
  const at = kuwaitInstant(D1, "01:30:00");
  assert.equal(attributeShiftDate(at, D1, []), D1);
});

test("split session 2 with +1 offset attributes to the shift date", () => {
  const session2: ShiftWindow = {
    shiftDate: D,
    startMs: kuwaitInstant(D, "20:00:00", 1),
    endMs: kuwaitInstant(D, "02:00:00", 2),
    sessionNo: 2,
  };
  const at = kuwaitInstant(D1, "21:00:00");
  assert.equal(attributeShiftDate(at, D1, [session2]), D);
});

test("overlapping windows pick the earliest start, deterministically", () => {
  const later: ShiftWindow = {
    shiftDate: D1,
    startMs: kuwaitInstant(D1, "00:00:00"),
    endMs: kuwaitInstant(D1, "08:00:00"),
    sessionNo: 1,
  };
  const at = kuwaitInstant(D1, "01:00:00");
  const first = attributeShiftDate(at, D1, [later, overnight()]);
  const second = attributeShiftDate(at, D1, [overnight(), later]);
  assert.equal(first, D);
  assert.equal(second, D);
});

test("older shifts outside kd-1..kd are ignored", () => {
  const old: ShiftWindow = {
    shiftDate: "2026-09-10",
    startMs: kuwaitInstant("2026-09-10", "08:00:00"),
    endMs: kuwaitInstant("2026-09-10", "18:00:00"),
    sessionNo: 1,
  };
  const at = kuwaitInstant(D1, "01:30:00");
  assert.equal(attributeShiftDate(at, D1, [old]), D1);
});
