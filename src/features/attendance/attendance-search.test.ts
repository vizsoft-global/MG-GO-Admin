import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fieldSearchMatch } from "@/components/app/app-list-controls/search-match";
import type { AttendanceDailyRow } from "./attendance-reporting-types";

describe("attendance daily rows search matching", () => {
  const sampleRow: AttendanceDailyRow = {
    driver_id: "10782",
    driver_code: "DRV-10782",
    employee_id: "EMP-9421",
    driver_name: "John Doe",
    driver_phone: "+96512345678",
    log_date: "2026-11-01",
    partner_id: null,
    partner_name: null,
    zone_id: null,
    zone_name: "Kuwait City",
    is_on_duty: true,
    shift_type: "single",
    scheduled_start_at: null,
    scheduled_end_at: null,
    attendance_log_id: null,
    check_in_at: null,
    check_out_at: null,
    check_out_reason: null,
    attendance_status: "checked_in",
    online_seconds: 3600,
    duty_seconds: 3600,
    minutes_late: 0,
    minutes_early_out: 0,
    last_seen_at: null,
    gps_zone_status: null,
    gps_accuracy_meters: null,
    gps_is_mocked: null,
    live_status: "on_duty",
    compliance_score: 100,
    check_in_photo_key: null,
    check_in_photo_at: null,
    check_in_restaurant_id: null,
    check_in_restaurant_name: null,
    check_in_distance_m: null,
  };

  const accessors = {
    name: (item: AttendanceDailyRow) => item.driver_name,
    employee_id: (item: AttendanceDailyRow) => item.employee_id,
    driver_code: (item: AttendanceDailyRow) => item.driver_code,
    driver_id: (item: AttendanceDailyRow) => item.driver_id,
    phone: (item: AttendanceDailyRow) => item.driver_phone,
    zone: (item: AttendanceDailyRow) => item.zone_name,
    status: (item: AttendanceDailyRow) => item.live_status,
  };

  it("matches rider by numeric driver_id (e.g. 10782)", () => {
    assert.ok(fieldSearchMatch(sampleRow, "10782", accessors));
  });

  it("matches rider by driver_code (e.g. DRV-10782)", () => {
    assert.ok(fieldSearchMatch(sampleRow, "DRV-10782", accessors));
  });

  it("matches rider by employee_id without shadowing driver_code or driver_id", () => {
    assert.ok(fieldSearchMatch(sampleRow, "EMP-9421", accessors));
    assert.ok(fieldSearchMatch(sampleRow, "9421", accessors));
    assert.ok(fieldSearchMatch(sampleRow, "10782", accessors));
  });

  it("matches rider by name and zone", () => {
    assert.ok(fieldSearchMatch(sampleRow, "John", accessors));
    assert.ok(fieldSearchMatch(sampleRow, "Kuwait", accessors));
  });

  it("returns false for non-matching search", () => {
    assert.equal(fieldSearchMatch(sampleRow, "99999", accessors), false);
  });
});

