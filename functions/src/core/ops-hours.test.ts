import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { kuwaitDayStart } from "./kuwait";
import {
  fullPopulationDpds,
  mergeSpans,
  onShiftHoursByDriver,
  overlapMs,
  shiftSessions,
  type AttendanceLogInput,
  type ShiftSessionInput,
} from "./ops-hours";

const DAY = "2026-10-26";
const DRIVER = "rider-a";

function kuwaitAt(day: string, hour: number, minute = 0): Date {
  return new Date(kuwaitDayStart(day).getTime() + (hour * 60 + minute) * 60_000);
}

function shift(partial: Partial<ShiftSessionInput> & Pick<ShiftSessionInput, "id">): ShiftSessionInput {
  return {
    driverId: DRIVER,
    day: DAY,
    isOff: false,
    shiftType: "regular",
    session1Start: "14:00",
    session1End: "22:00",
    session1EndDayOffset: 0,
    session2Start: null,
    session2End: null,
    session2StartDayOffset: 0,
    session2EndDayOffset: 0,
    ...partial,
  };
}

function log(partial: Partial<AttendanceLogInput> = {}): AttendanceLogInput {
  return {
    driverId: DRIVER,
    day: DAY,
    checkIn: kuwaitAt(DAY, 14),
    checkOut: kuwaitAt(DAY, 22),
    ...partial,
  };
}

describe("ops-hours spans", () => {
  it("merges overlapping spans and skips inverted ones", () => {
    assert.deepEqual(
      mergeSpans([
        { startMs: 20, endMs: 40 },
        { startMs: 10, endMs: 25 },
        { startMs: 50, endMs: 50 },
        { startMs: 60, endMs: 80 },
      ]),
      [
        { startMs: 10, endMs: 40 },
        { startMs: 60, endMs: 80 },
      ],
    );
  });

  it("overlap is the intersecting milliseconds", () => {
    assert.equal(overlapMs({ startMs: 0, endMs: 10 }, { startMs: 5, endMs: 12 }), 5);
    assert.equal(overlapMs({ startMs: 0, endMs: 10 }, { startMs: 10, endMs: 20 }), 0);
  });
});

describe("on-shift hours", () => {
  it("login 11:00Z–21:00Z vs 14:00–22:00 Kuwait is 8h", () => {
    const hours = onShiftHoursByDriver({
      logs: [
        {
          driverId: DRIVER,
          day: DAY,
          checkIn: new Date("2026-10-26T11:00:00.000Z"),
          checkOut: new Date("2026-10-26T21:00:00.000Z"),
        },
      ],
      shifts: [shift({ id: "s1" })],
      now: new Date("2026-10-26T21:00:00.000Z"),
    });
    assert.equal(hours.hoursByDriver.get(DRIVER), 8);
    assert.equal(hours.hoursByDriverDay.get(`${DRIVER}\t${DAY}`), 8);
  });

  it("split two rows sum session overlap and do not double-count", () => {
    const login = log({
      checkIn: kuwaitAt(DAY, 7),
      checkOut: kuwaitAt(DAY, 23),
    });
    const hours = onShiftHoursByDriver({
      logs: [login],
      shifts: [
        shift({
          id: "split-a",
          shiftType: "split",
          session1Start: "08:00",
          session1End: "12:00",
          session2Start: "16:00",
          session2End: "22:00",
        }),
        shift({
          id: "split-b",
          shiftType: "split",
          session1Start: "08:00",
          session1End: "12:00",
          session2Start: "16:00",
          session2End: "22:00",
        }),
      ],
      now: kuwaitAt(DAY, 23),
    });
    assert.equal(hours.hoursByDriver.get(DRIVER), 10);
  });

  it("duplicate session1 on two docs merges rather than doubles", () => {
    const hours = onShiftHoursByDriver({
      logs: [log({ checkIn: kuwaitAt(DAY, 8), checkOut: kuwaitAt(DAY, 18) })],
      shifts: [
        shift({ id: "dup-1", session1Start: "10:00", session1End: "16:00" }),
        shift({ id: "dup-2", session1Start: "10:00", session1End: "16:00" }),
      ],
      now: kuwaitAt(DAY, 18),
    });
    assert.equal(hours.hoursByDriver.get(DRIVER), 6);
  });

  it("OFF is 0 even with a 10h login", () => {
    const hours = onShiftHoursByDriver({
      logs: [log({ checkIn: kuwaitAt(DAY, 8), checkOut: kuwaitAt(DAY, 18) })],
      shifts: [shift({ id: "off", isOff: true })],
      now: kuwaitAt(DAY, 18),
    });
    assert.equal(hours.hoursByDriver.size, 0);
    assert.equal(shiftSessions(shift({ id: "off", isOff: true })).length, 0);
  });

  it("missing shift is 0", () => {
    const hours = onShiftHoursByDriver({
      logs: [log({ checkIn: kuwaitAt(DAY, 8), checkOut: kuwaitAt(DAY, 18) })],
      shifts: [],
      now: kuwaitAt(DAY, 18),
    });
    assert.equal(hours.hoursByDriver.size, 0);
    assert.equal(hours.hoursByDriverDay.size, 0);
  });

  it("open log uses now inside the shift window", () => {
    const hours = onShiftHoursByDriver({
      logs: [log({ checkIn: kuwaitAt(DAY, 14), checkOut: null })],
      shifts: [shift({ id: "open" })],
      now: kuwaitAt(DAY, 18),
    });
    assert.equal(hours.hoursByDriver.get(DRIVER), 4);
  });

  it("hours 0 or missing stay off the maps", () => {
    const hours = onShiftHoursByDriver({
      logs: [log({ checkIn: null, checkOut: null })],
      shifts: [shift({ id: "empty" })],
      now: kuwaitAt(DAY, 18),
    });
    assert.equal(hours.hoursByDriver.size, 0);
    assert.equal(hours.hoursByDriverDay.size, 0);
  });

  it("overlapping login spans merge before overlap", () => {
    const hours = onShiftHoursByDriver({
      logs: [
        log({ checkIn: kuwaitAt(DAY, 14), checkOut: kuwaitAt(DAY, 18) }),
        log({ checkIn: kuwaitAt(DAY, 16), checkOut: kuwaitAt(DAY, 20) }),
      ],
      shifts: [shift({ id: "login-merge", session1Start: "14:00", session1End: "22:00" })],
      now: kuwaitAt(DAY, 22),
    });
    assert.equal(hours.hoursByDriver.get(DRIVER), 6);
  });
});

describe("full-population DPD", () => {
  it("includes riders a slicer would drop", () => {
    const { storeDpd, zoneVehicleDpd } = fullPopulationDpds([
      {
        restaurantId: "store-a",
        zoneId: "z1",
        vehicleKey: "bike",
        orders: 10,
        workingDays: 2,
      },
      {
        restaurantId: "store-a",
        zoneId: "z1",
        vehicleKey: "bike",
        orders: 5,
        workingDays: 1,
      },
    ]);
    assert.equal(storeDpd.get("store-a"), 5);
    assert.equal(zoneVehicleDpd.get("z1|bike"), 5);
  });

  it("zero working days stay null not 0", () => {
    const { storeDpd } = fullPopulationDpds([
      { restaurantId: "empty", zoneId: null, vehicleKey: null, orders: 4, workingDays: 0 },
    ]);
    assert.equal(storeDpd.get("empty"), null);
  });
});
