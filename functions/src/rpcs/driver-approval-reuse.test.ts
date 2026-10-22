import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizedName, pickReusableDriver, type LiveDriverClash } from "./driver-approval-reuse";

const ARCHIVED = { _seconds: 1 };

function clash(over: Partial<LiveDriverClash> = {}): LiveDriverClash {
  return {
    id: "driver-1",
    archivedAt: null,
    fullName: "MIJANUR",
    phone: "+965 6603 6208",
    previousIntake: "archived",
    hasProfile: true,
    ...over,
  };
}

test("normalizedName trims, collapses and upper-cases", () => {
  assert.equal(normalizedName("  mijanur   ali "), "MIJANUR ALI");
  assert.equal(normalizedName("   "), null);
  assert.equal(normalizedName(null), null);
});

test("a re-added rider adopts the row its archived intake created", () => {
  assert.deepEqual(
    pickReusableDriver({ intakeName: "Mijanur", intakePhone: "+96566036208", clashes: [clash()] }),
    { kind: "reuse", driverId: "driver-1" },
  );
});

test("a live previous intake adopts when name and phone both match", () => {
  assert.deepEqual(
    pickReusableDriver({
      intakeName: "MIJANUR",
      intakePhone: "+96566036208",
      clashes: [clash({ previousIntake: "live" })],
    }),
    { kind: "reuse", driverId: "driver-1" },
  );
});

test("a live previous intake with a different phone is a different rider", () => {
  assert.deepEqual(
    pickReusableDriver({
      intakeName: "MIJANUR",
      intakePhone: "+96500000000",
      clashes: [clash({ previousIntake: "live" })],
    }),
    { kind: "none" },
  );
});

test("a live pointer on a row nobody can sign in as does not withhold adoption", () => {
  assert.deepEqual(
    pickReusableDriver({
      intakeName: "MIJANUR",
      intakePhone: "+96566036208",
      clashes: [clash({ previousIntake: "live", hasProfile: false, phone: "+96599999999" })],
    }),
    { kind: "reuse", driverId: "driver-1" },
  );
});

test("a live previous intake needs the phone on both sides", () => {
  assert.deepEqual(
    pickReusableDriver({
      intakeName: "MIJANUR",
      intakePhone: "+96566036208",
      clashes: [clash({ previousIntake: "live", phone: null })],
    }),
    { kind: "none" },
  );
  assert.deepEqual(
    pickReusableDriver({
      intakeName: "MIJANUR",
      intakePhone: null,
      clashes: [clash({ previousIntake: "live" })],
    }),
    { kind: "none" },
  );
});

test("an intake without a phone still matches on the archived intake and name", () => {
  assert.deepEqual(
    pickReusableDriver({ intakeName: "MIJANUR", intakePhone: null, clashes: [clash({ phone: null })] }),
    { kind: "reuse", driverId: "driver-1" },
  );
});

test("a different phone is a different rider", () => {
  assert.deepEqual(
    pickReusableDriver({ intakeName: "MIJANUR", intakePhone: "+96500000000", clashes: [clash()] }),
    { kind: "none" },
  );
});

test("a missing driver phone is absence of data, not a mismatch", () => {
  assert.deepEqual(
    pickReusableDriver({ intakeName: "MIJANUR", intakePhone: "+96566036208", clashes: [clash({ phone: null })] }),
    { kind: "reuse", driverId: "driver-1" },
  );
});

test("a different name never adopts", () => {
  assert.deepEqual(
    pickReusableDriver({ intakeName: "SOMEONE ELSE", intakePhone: "+96566036208", clashes: [clash()] }),
    { kind: "none" },
  );
});

test("an unreadable intake pointer matches on the name and one-sided phone", () => {
  assert.deepEqual(
    pickReusableDriver({
      intakeName: "MIJANUR",
      intakePhone: "+96566036208",
      clashes: [clash({ previousIntake: "unknown", phone: null })],
    }),
    { kind: "reuse", driverId: "driver-1" },
  );
  assert.deepEqual(
    pickReusableDriver({
      intakeName: "MIJANUR",
      intakePhone: "+96566036208",
      clashes: [clash({ previousIntake: "unknown" })],
    }),
    { kind: "reuse", driverId: "driver-1" },
  );
});

test("a live row with no name adopts on the phone alone", () => {
  assert.deepEqual(
    pickReusableDriver({
      intakeName: "MIJANUR",
      intakePhone: "+96566036208",
      clashes: [clash({ fullName: null, phone: "+96566036208" })],
    }),
    { kind: "reuse", driverId: "driver-1" },
  );
  assert.deepEqual(
    pickReusableDriver({
      intakeName: "MIJANUR",
      intakePhone: "+96566036208",
      clashes: [clash({ fullName: null, phone: null })],
    }),
    { kind: "reuse", driverId: "driver-1" },
  );
});

test("a live row with no name and a different phone is still a different rider", () => {
  assert.deepEqual(
    pickReusableDriver({
      intakeName: "MIJANUR",
      intakePhone: "+96566036208",
      clashes: [clash({ fullName: null, phone: "+96500000000" })],
    }),
    { kind: "none" },
  );
});

test("a nameless row owned by another live intake still needs the phone on both sides", () => {
  assert.deepEqual(
    pickReusableDriver({
      intakeName: "MIJANUR",
      intakePhone: "+96566036208",
      clashes: [clash({ fullName: null, phone: null, previousIntake: "live" })],
    }),
    { kind: "none" },
  );
});

test("an archived driver releases the id and is skipped", () => {
  assert.deepEqual(
    pickReusableDriver({
      intakeName: "MIJANUR",
      intakePhone: "+96566036208",
      clashes: [clash({ archivedAt: ARCHIVED })],
    }),
    { kind: "none" },
  );
});

test("a driver with no intake pointer adopts when the name matches", () => {
  assert.deepEqual(
    pickReusableDriver({
      intakeName: "MIJANUR",
      intakePhone: "+96566036208",
      clashes: [clash({ previousIntake: "unknown" })],
    }),
    { kind: "reuse", driverId: "driver-1" },
  );
});

test("two qualifying rows are ambiguous rather than picking one", () => {
  assert.deepEqual(
    pickReusableDriver({
      intakeName: "MIJANUR",
      intakePhone: "+96566036208",
      clashes: [clash(), clash({ id: "driver-2" })],
    }),
    { kind: "ambiguous" },
  );
});

test("an intake with no name adopts nothing", () => {
  assert.deepEqual(
    pickReusableDriver({ intakeName: null, intakePhone: "+96566036208", clashes: [clash()] }),
    { kind: "none" },
  );
});

test("a row nobody can sign in as does not outrank the rider's own row", () => {
  assert.deepEqual(
    pickReusableDriver({
      intakeName: "MD SHAFIKUL ISLAM",
      intakePhone: "+96566036208",
      clashes: [
        clash({ id: "skeleton", fullName: "", phone: null, hasProfile: false }),
        clash({ id: "driver-2", fullName: "MD SHAFIKUL ISLAM", phone: "+96566036208" }),
      ],
    }),
    { kind: "reuse", driverId: "driver-2" },
  );
});

test("a profile-less nameless row is still adopted when it is the only candidate", () => {
  assert.deepEqual(
    pickReusableDriver({
      intakeName: "MIJANUR",
      intakePhone: "+96566036208",
      clashes: [clash({ fullName: null, phone: null, hasProfile: false })],
    }),
    { kind: "reuse", driverId: "driver-1" },
  );
});

test("two profile-less rows are debris, so the lowest id is adopted and the rest retired", () => {
  assert.deepEqual(
    pickReusableDriver({
      intakeName: "MIJANUR",
      intakePhone: "+96566036208",
      clashes: [
        clash({ id: "debris-2", fullName: null, phone: null, hasProfile: false }),
        clash({ id: "debris-1", fullName: null, phone: null, hasProfile: false }),
      ],
    }),
    { kind: "reuse", driverId: "debris-1" },
  );
});

test("two attestable rows with the same name and phone stay ambiguous", () => {
  assert.deepEqual(
    pickReusableDriver({
      intakeName: "MIJANUR",
      intakePhone: "+96566036208",
      clashes: [clash(), clash({ id: "driver-2" })],
    }),
    { kind: "ambiguous" },
  );
});
