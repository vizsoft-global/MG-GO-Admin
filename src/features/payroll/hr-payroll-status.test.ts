import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HR_STATUS_ORDER,
  hrStatusKeyFromLabel,
  hrStatusPaint,
  isEndOfContract,
  isHrActive,
} from "./hr-payroll-status";

describe("hr status", () => {
  it("paints every catalog status and both cancelled branches", () => {
    assert.equal(HR_STATUS_ORDER.length, 12);
    assert.equal(hrStatusPaint("leave").fill, "#F28C28");
    assert.equal(hrStatusPaint("leave_return").fill, "#BFE4F8");
    assert.equal(hrStatusPaint("accident").fill, "#FFE45C");
    assert.equal(hrStatusPaint("absent_mosal").text, "#FFFFFF");
    assert.equal(hrStatusPaint("absent_moi").fill, "#D13B3B");
    assert.equal(hrStatusPaint("on_hold").fill, "#D13B3B");
    assert.equal(hrStatusPaint("new").fill, "#DCCDF6");
    assert.equal(hrStatusPaint("training").fill, "#FFD9B0");
    assert.equal(hrStatusPaint("transfer_from_company").fill, "#C9EEC4");
    assert.equal(hrStatusPaint("running").bordered, true);
    assert.equal(hrStatusPaint("extension").fill, "transparent");
    assert.equal(hrStatusPaint("cancelled", "End of Contract").fill, "#1E6B3A");
    assert.equal(hrStatusPaint("cancelled", " resigned ").fill, "#D13B3B");
    assert.equal(hrStatusPaint("cancelled", "", true).split, true);
    assert.equal(isEndOfContract(" end of contract "), true);
    assert.equal(isEndOfContract("end_of_contract"), true);
    assert.equal(hrStatusKeyFromLabel("New hire"), "new");
    assert.equal(hrStatusKeyFromLabel("Leave Return"), "leave_return");
  });

  it("treats a blank status as active and the four hold statuses as inactive", () => {
    assert.equal(isHrActive(""), true);
    assert.equal(isHrActive("running"), true);
    assert.equal(isHrActive("new"), true);
    assert.equal(isHrActive("cancelled"), false);
    assert.equal(isHrActive("on_hold"), false);
    assert.equal(isHrActive("absent_mosal"), false);
    assert.equal(isHrActive("absent_moi"), false);
  });
});
