import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PAYROLL_ATTENDANCE_FIELDS, PAYROLL_RECON_FIELDS, payrollHoursFromFields } from "./payroll-read-plan";

describe("payroll read plan", () => {
  it("reads the hours inputs and the recon grain, nothing wider", () => {
    assert.deepEqual(PAYROLL_ATTENDANCE_FIELDS, [
      "driver_id",
      "log_date",
      "worked_minutes",
      "check_in_at",
      "check_out_at",
    ]);
    assert.deepEqual(PAYROLL_RECON_FIELDS, ["employee_id", "work_date", "run_id", "excel_orders"]);
  });

  it("keeps a zero-hour open log visible as zero and prefers worked minutes", () => {
    assert.equal(payrollHoursFromFields({ worked_minutes: 90 }), 1.5);
    assert.equal(payrollHoursFromFields({
      check_in_at: "2026-10-13T05:00:00.000Z",
      check_out_at: "2026-10-13T08:00:00.000Z",
    }), 3);
    assert.equal(payrollHoursFromFields({ check_in_at: "2026-10-13T05:00:00.000Z" }), 0);
  });
});