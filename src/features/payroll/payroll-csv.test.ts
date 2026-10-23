import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AO_HEADING_KEYS } from "./payroll-column-config";
import {
  AO_LEAD_HEADERS,
  AO_LEAD_KEYS,
  APP_ATTENDANCE_HEADERS,
  APP_ATTENDANCE_KEYS,
  COMBINED_IDENTITY_HEADERS,
  COMBINED_IDENTITY_KEYS,
  payrollHubExportKind,
} from "./payroll-csv";

describe("payroll hub export", () => {
  it("maps each hub tab to its own dataset, and Settings to none", () => {
    assert.equal(payrollHubExportKind("payroll"), "payroll");
    assert.equal(payrollHubExportKind("combined"), "combined");
    assert.equal(payrollHubExportKind("attendance-orders"), "ao");
    assert.equal(payrollHubExportKind("requests"), "requests");
    assert.equal(payrollHubExportKind("settings"), null);
  });

  it("puts restaurant name and id on the Attendance & Orders identity keys", () => {
    assert.deepEqual([...AO_LEAD_KEYS], [...AO_HEADING_KEYS]);
    assert.equal(AO_LEAD_KEYS.length, AO_LEAD_HEADERS.length);
    assert.ok(AO_LEAD_KEYS.includes("restaurant"));
    assert.ok(AO_LEAD_KEYS.includes("restaurantId"));
  });

  it("exports a Status cell right after Vehicle on every identity block", () => {
    for (const [keys, headers] of [
      [COMBINED_IDENTITY_KEYS, COMBINED_IDENTITY_HEADERS],
      [AO_LEAD_KEYS, AO_LEAD_HEADERS],
      [APP_ATTENDANCE_KEYS, APP_ATTENDANCE_HEADERS],
    ] as const) {
      assert.equal(keys.length, headers.length);
      const index = keys.indexOf("status");
      assert.notEqual(index, -1);
      assert.equal(keys[index - 1], "vehicleKind");
      assert.equal(headers[index], "Status");
    }
  });
});
