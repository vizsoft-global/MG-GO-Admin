import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readEsignSnapshotExtra } from "./esign-snapshot-extra";

describe("readEsignSnapshotExtra", () => {
  it("reads a driver column, then custom_fields, then the intake", () => {
    const fromDriver = readEsignSnapshotExtra(
      { position: " Rider ", custom_fields: { sponsor: "ignored" } },
      { sponsor: "intake" },
    );
    assert.equal(fromDriver.position, "Rider");
    assert.equal(fromDriver.sponsor, "ignored");

    const fromIntake = readEsignSnapshotExtra(
      { custom_fields: { pay_through: "" } },
      { pay_through: "2026-10-31", bank_number: 1001, custom_fields: { position: "Intake role" } },
    );
    assert.equal(fromIntake.position, "Intake role");
    assert.equal(fromIntake.pay_through, "2026-10-31");
    assert.equal(fromIntake.bank_number, "1001");
    assert.equal(fromIntake.sponsor, null);
  });

  it("leaves every key null when neither record has it", () => {
    assert.deepEqual(readEsignSnapshotExtra({ employee_id: "1" }, null), {
      position: null,
      sponsor: null,
      pay_through: null,
      bank_number: null,
    });
  });
});
