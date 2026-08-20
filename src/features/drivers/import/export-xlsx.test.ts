import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCredentialsAoa, buildImportErrorAoa } from "./export-xlsx";

describe("buildImportErrorAoa", () => {
  it("includes preview invalid rows and apply failures", () => {
    const aoa = buildImportErrorAoa(
      ["Full Name", "Phone"],
      [
        ["Ahmed", "99123456"],
        ["Sara", "99223456"],
      ],
      [
        { rowIndex: 0, status: "ok" },
        { rowIndex: 1, status: "duplicate_phone" },
      ],
      [{ rowIndex: 0, reason: "save_failed" }],
    );
    assert.equal(aoa.length, 3);
    assert.deepEqual(aoa[1], [1, "apply_failed", "save_failed", "Ahmed", "99123456"]);
    assert.deepEqual(aoa[2], [2, "duplicate_phone", "", "Sara", "99223456"]);
  });
});

describe("buildCredentialsAoa", () => {
  it("writes employee id, driver code, and passcode", () => {
    const aoa = buildCredentialsAoa([
      { employee_id: "12345", driver_code: "10001", passcode: "654321" },
    ]);
    assert.deepEqual(aoa[1], ["12345", "10001", "654321"]);
  });
});
