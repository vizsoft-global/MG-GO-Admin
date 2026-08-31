import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DRIVER_CHANGE_SOURCES,
  diffDriverChange,
  displayChangeValue,
  flattenProfileSnapshot,
  sanitizeDriverChangeContext,
  shouldInsertDriverChange,
} from "./driver-change-log-shared";

describe("displayChangeValue", () => {
  it("collapses empty spellings onto null", () => {
    assert.equal(displayChangeValue(null), null);
    assert.equal(displayChangeValue(""), null);
    assert.equal(displayChangeValue("  "), null);
    assert.equal(displayChangeValue([]), null);
  });
});

describe("diffDriverChange", () => {
  it("omits unchanged keys", () => {
    const changes = diffDriverChange(
      { phone: "5551234", zone: "Hawalli" },
      { phone: "5551234", zone: "Salmiya" },
    );
    assert.deepEqual(changes, [{ field: "zone", before: "Hawalli", after: "Salmiya" }]);
  });

  it("emits before null on a first create", () => {
    const after = flattenProfileSnapshot({
      full_name: "Ahmed Ali",
      phone: "5551234",
      employee_id: "12345",
      custom_fields: { vest_size: "M" },
    });
    const changes = diffDriverChange({}, after);
    assert.equal(
      changes.find((c) => c.field === "full_name")?.before,
      null,
    );
    assert.equal(changes.find((c) => c.field === "full_name")?.after, "Ahmed Ali");
    assert.equal(changes.find((c) => c.field === "custom.vest_size")?.after, "M");
  });

  it("keys custom fields as custom.<key>", () => {
    const changes = diffDriverChange(
      flattenProfileSnapshot({ custom_fields: { vest_size: "S" } }),
      flattenProfileSnapshot({ custom_fields: { vest_size: "M" } }),
    );
    assert.deepEqual(changes, [
      { field: "custom.vest_size", before: "S", after: "M" },
    ]);
  });
});

describe("shouldInsertDriverChange", () => {
  it("skips an empty edit", () => {
    assert.equal(shouldInsertDriverChange("edit", []), false);
    assert.equal(shouldInsertDriverChange("bulk_import", []), false);
    assert.equal(shouldInsertDriverChange("assignment", []), false);
  });

  it("still writes approve / archive / passcode with no field diffs", () => {
    assert.equal(shouldInsertDriverChange("approve", []), true);
    assert.equal(shouldInsertDriverChange("archive", []), true);
    assert.equal(shouldInsertDriverChange("passcode", []), true);
  });
});

describe("sanitizeDriverChangeContext", () => {
  it("never keeps a passcode key or value", () => {
    const cleaned = sanitizeDriverChangeContext({
      note: "passcode replaced",
      passcode: "123456",
      file: "fleet.xlsx",
    });
    assert.equal(cleaned.passcode, undefined);
    assert.equal(cleaned.note, "passcode replaced");
    assert.equal(cleaned.file, "fleet.xlsx");
    assert.doesNotMatch(JSON.stringify(cleaned), /123456/);
  });
});

describe("DRIVER_CHANGE_SOURCES", () => {
  it("matches the check-constraint catalogue", () => {
    assert.deepEqual([...DRIVER_CHANGE_SOURCES], [
      "manual_create",
      "bulk_import",
      "edit",
      "approve",
      "archive",
      "restore",
      "status",
      "block",
      "unblock",
      "passcode",
      "document",
      "asset",
      "assignment",
    ]);
  });
});
