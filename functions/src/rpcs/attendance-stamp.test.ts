import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attendanceDisplayName,
  attendanceIdentityMissing,
  pickMissingAttendanceDenorm,
  stampAttendanceLogDenorm,
} from "./attendance-stamp";

describe("attendance stamp", () => {
  it("prefers profile name then driver name then code", () => {
    assert.equal(attendanceDisplayName("Ali", "Driver", "10001"), "Ali");
    assert.equal(attendanceDisplayName("  ", "Driver", "10001"), "Driver");
    assert.equal(attendanceDisplayName(null, null, "10001"), "10001");
    assert.equal(attendanceDisplayName(null, null, null), null);
  });

  it("stamps duty and identity and skips duty when filling missing fields", () => {
    const stamp = stampAttendanceLogDenorm({
      driver: { name: "Driver", driver_code: "10955", employee_id: "40028" },
      profile: { full_name: "ASADUR RAHMAN" },
      isOnDuty: true,
    });
    assert.equal(stamp["driver_name"], "ASADUR RAHMAN");
    assert.equal(stamp["driver_code"], "10955");
    assert.equal(stamp["employee_id"], "40028");
    assert.equal(stamp["is_on_duty"], true);
    assert.equal(attendanceIdentityMissing({ driver_name: "", driver_code: "10955" }), true);
    assert.deepEqual(
      pickMissingAttendanceDenorm(
        { driver_name: "", driver_code: "10955", employee_id: "40028", is_on_duty: false },
        stamp,
      ),
      { driver_name: "ASADUR RAHMAN" },
    );
  });
});
