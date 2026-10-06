import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AO_HEADING_KEYS } from "./payroll-column-config";
import { AO_LEAD_HEADERS, AO_LEAD_KEYS, payrollHubExportKind } from "./payroll-csv";

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
});
