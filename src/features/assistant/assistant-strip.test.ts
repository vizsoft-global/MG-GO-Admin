import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assistantModuleAllowed, canShowContact } from "./assistant-gates";
import {
  assertNoForbiddenKeys,
  pickAllowlisted,
  sectionDenied,
  stripAttendanceDay,
  stripDeliveryHead,
  stripDriverIdentity,
  stripNotificationRow,
  stripPerformanceRow,
  stripRequestRow,
  stripVehicleRow,
} from "./assistant-strip";

describe("assistant strip", () => {
  it("omits forbidden keys and only shows phone/email when asked", () => {
    const raw = {
      id: "d1",
      full_name: "Ahmed",
      driver_code: "10245",
      employee_id: "10001",
      phone: "+96555551234",
      email: "a@x.com",
      civil_id: "secret",
      app_passcode: "123456",
      zone_label: "Hawally",
      zone_id: "z1",
      account_status: "active",
    };
    const hidden = stripDriverIdentity(raw, { showContact: false });
    const shown = stripDriverIdentity(raw, { showContact: true });
    assert.equal(hidden.phone, undefined);
    assert.equal(hidden.email, undefined);
    assert.equal(shown.phone, "+96555551234");
    assert.equal(shown.email, "a@x.com");
    assert.doesNotThrow(() => assertNoForbiddenKeys(hidden));
    assert.doesNotThrow(() => assertNoForbiddenKeys(shown));
    assert.throws(() => assertNoForbiddenKeys(raw), /forbidden_key:civil_id/);
  });

  it("strips attendance GPS, vehicle chassis/chip, request payload, notification body", () => {
    assert.equal(
      stripAttendanceDay({
        driver_id: "d1",
        log_date: "2026-09-21",
        gps_accuracy_meters: 12,
        gps_is_mocked: true,
        attendance_status: "present",
      }).gps_accuracy_meters,
      undefined,
    );
    const vehicle = stripVehicleRow({
      id: "v1",
      bike_id: "B-1",
      chassis_no: "CH",
      chip_no: "CHIP",
      assigned_driver_code: "10245",
    });
    assert.equal(vehicle.chassis_no, undefined);
    assert.equal(vehicle.chip_no, undefined);
    assert.equal(vehicle.assigned_driver_code, "10245");
    const request = stripRequestRow({
      id: "r1",
      request_code: "RCM-1",
      payload: { note: "hidden" },
      status: "in_review",
    });
    assert.equal(request.payload, undefined);
    const notice = stripNotificationRow({
      id: "n1",
      title: "Ping",
      body: "secret copy",
      target_spec: { all: true },
      status: "sent",
      sent_at: "2026-09-21",
      recipient_count: 3,
      failed_count: 0,
    });
    assert.equal(notice.body, undefined);
    assert.equal(notice.target_spec, undefined);
    assert.equal(notice.title, "Ping");
    const delivery = stripDeliveryHead({
      id: "del1",
      status: "verified",
      latitude: 29.3,
      longitude: 47.9,
    });
    assert.equal(delivery.latitude, undefined);
    const perf = stripPerformanceRow({
      driver_id: "d1",
      overall_score: 40,
      absent_days: 2,
      civil_id: "x",
    });
    assert.equal(perf.civil_id, undefined);
    assert.equal(perf.overall_score, 40);
    assert.deepEqual(sectionDenied("/drivers"), { error: "not_authorized", page: "/drivers" });
    assert.deepEqual(pickAllowlisted({ a: 1, payload: {} }, ["a", "payload"]), { a: 1 });
  });
});

describe("contact permission", () => {
  it("shows contact only with assistant.view plus the module view", () => {
    const session = {
      id: "s",
      email: null,
      permissions: new Set(["assistant.view", "drivers.view"]),
      isSuperAdmin: false,
    };
    assert.equal(canShowContact(session as never, "drivers.view"), true);
    assert.equal(
      canShowContact(
        { ...session, permissions: new Set(["assistant.view"]) } as never,
        "drivers.view",
      ),
      false,
    );
    assert.equal(assistantModuleAllowed(new Set(["assistant.view"]), false, "drivers.view"), false);
  });
});
