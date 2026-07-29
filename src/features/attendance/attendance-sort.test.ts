import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attendanceSortDirection,
  nextAttendanceSortKey,
  normalizeAttendanceSortKey,
  sortAttendanceDailyRows,
} from "./attendance-list-utils";
import type { AttendanceDailyRow } from "./attendance-reporting-types";

function row(
  partial: Pick<AttendanceDailyRow, "driver_id" | "driver_name" | "live_status"> &
    Partial<AttendanceDailyRow>,
): AttendanceDailyRow {
  return {
    log_date: "2026-07-29",
    driver_code: "10000",
    employee_id: null,
    driver_phone: "",
    partner_id: null,
    partner_name: null,
    zone_id: null,
    zone_name: null,
    is_on_duty: false,
    shift_type: null,
    scheduled_start_at: null,
    scheduled_end_at: null,
    attendance_log_id: null,
    check_in_at: null,
    check_out_at: null,
    check_out_reason: null,
    attendance_status: "absent",
    online_seconds: 0,
    duty_seconds: 0,
    minutes_late: 0,
    minutes_early_out: 0,
    last_seen_at: null,
    gps_zone_status: null,
    gps_accuracy_meters: null,
    gps_is_mocked: null,
    compliance_score: null,
    ...partial,
  };
}

describe("attendance column sort helpers", () => {
  it("normalizes legacy last_seen to desc", () => {
    assert.equal(normalizeAttendanceSortKey("last_seen"), "last_seen_desc");
    assert.equal(normalizeAttendanceSortKey("status_asc"), "status_asc");
  });

  it("cycles inactive → asc → desc → asc", () => {
    assert.equal(nextAttendanceSortKey("problems_first", "check_in"), "check_in_asc");
    assert.equal(nextAttendanceSortKey("check_in_asc", "check_in"), "check_in_desc");
    assert.equal(nextAttendanceSortKey("check_in_desc", "check_in"), "check_in_asc");
  });

  it("reports direction for active column only", () => {
    assert.equal(attendanceSortDirection("status_asc", "status"), "asc");
    assert.equal(attendanceSortDirection("status_desc", "status"), "desc");
    assert.equal(attendanceSortDirection("status_asc", "check_in"), false);
    assert.equal(attendanceSortDirection("last_seen", "last_seen"), "desc");
  });
});

describe("sortAttendanceDailyRows", () => {
  it("reorders by check-in desc", () => {
    const rows = [
      row({
        driver_id: "a",
        driver_name: "Ahmed",
        live_status: "no_shift",
        check_in_at: "2026-07-29T00:51:00+03:00",
      }),
      row({
        driver_id: "b",
        driver_name: "Anand",
        live_status: "no_shift",
        check_in_at: "2026-07-29T01:38:00+03:00",
      }),
      row({
        driver_id: "c",
        driver_name: "Aslam",
        live_status: "no_shift",
        check_in_at: "2026-07-29T00:19:00+03:00",
      }),
    ];
    const sorted = sortAttendanceDailyRows(rows, "check_in_desc");
    assert.deepEqual(
      sorted.map((r) => r.driver_name),
      ["Anand", "Ahmed", "Aslam"],
    );
  });

  it("same status uses check-in tie-break instead of name A–Z", () => {
    const rows = [
      row({
        driver_id: "a",
        driver_name: "Ahmed",
        live_status: "no_shift",
        check_in_at: "2026-07-29T00:51:00+03:00",
      }),
      row({
        driver_id: "b",
        driver_name: "Anand",
        live_status: "no_shift",
        check_in_at: "2026-07-29T01:38:00+03:00",
      }),
    ];
    const sorted = sortAttendanceDailyRows(rows, "status_desc");
    assert.equal(sorted[0]?.driver_name, "Anand");
  });

  it("sorts on-duty before off-duty for on_duty_desc", () => {
    const rows = [
      row({
        driver_id: "a",
        driver_name: "Ahmed",
        live_status: "no_shift",
        is_on_duty: false,
      }),
      row({
        driver_id: "b",
        driver_name: "Bhoj",
        live_status: "on_duty",
        is_on_duty: true,
      }),
    ];
    const sorted = sortAttendanceDailyRows(rows, "on_duty_desc");
    assert.equal(sorted[0]?.driver_name, "Bhoj");
  });
});
