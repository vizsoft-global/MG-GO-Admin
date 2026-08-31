import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APP_CODE_EXPORT_ID,
  DRIVER_EXPORT_PINNED_IDS,
  buildDriversExportAoa,
  customExportColumnId,
  driversExportCsv,
  resolveExportColumnIds,
} from "./export-drivers";
import type { DriverListRow } from "./types";

function row(overrides: Partial<DriverListRow> = {}): DriverListRow {
  return {
    id: "row-1",
    driver_code: "10001",
    employee_id: "EMP1",
    full_name: "Ahmed Ali",
    phone: "99123456",
    partner_id: "p1",
    partner_name: "Talabat",
    partner_logo_url: null,
    zone_id: "z1",
    zone_name: "Hawally",
    restaurant_ids: ["r1"],
    restaurant_names: ["Burger Hub"],
    workflow_status: "approved",
    linked: true,
    linked_profile_id: "prof-1",
    account_status: "active",
    is_blocked: false,
    blocked_reason: null,
    is_on_duty: true,
    today_deliveries: 4,
    app_passcode: "123456",
    archived_at: null,
    avatar_url: null,
    avatar_display_url: null,
    rider_category: "in_house",
    client_id: "CLI-1",
    client_name: "Gulf Retail",
    custom_fields: { helmet_size: "M" },
    ...overrides,
  };
}

describe("resolveExportColumnIds", () => {
  it("keeps identity columns even when the operator cleared them", () => {
    assert.deepEqual(resolveExportColumnIds(["phone"]), [
      ...DRIVER_EXPORT_PINNED_IDS,
      "phone",
    ]);
  });
});

describe("buildDriversExportAoa", () => {
  it("writes only the chosen columns", () => {
    const aoa = buildDriversExportAoa([row()], ["phone", "zone"]);
    assert.deepEqual(aoa[0], [
      "driver_code",
      "employee_id",
      "full_name",
      "phone",
      "zone",
    ]);
    assert.deepEqual(aoa[1], ["10001", "EMP1", "Ahmed Ali", "99123456", "Hawally"]);
  });

  it("keeps the app code off the sheet unless the toggle is on", () => {
    const without = buildDriversExportAoa([row()], ["phone"]);
    assert.equal(without[0]?.includes(APP_CODE_EXPORT_ID), false);

    const withCode = buildDriversExportAoa([row()], ["phone"], {
      includeAppCode: true,
    });
    assert.equal(withCode[0]?.at(-1), APP_CODE_EXPORT_ID);
    assert.equal(withCode[1]?.at(-1), "123456");
  });

  it("does not write a passcode for an archived rider", () => {
    const aoa = buildDriversExportAoa(
      [row({ archived_at: "2026-08-01T00:00:00.000Z" })],
      [],
      { includeAppCode: true },
    );
    assert.equal(aoa[1]?.at(-1), "");
  });

  it("adds a labelled custom-field column when it was ticked", () => {
    const field = { key: "helmet_size", label: "Helmet" };
    const aoa = buildDriversExportAoa([row()], [customExportColumnId("helmet_size")], {
      customFields: [field],
    });
    assert.equal(aoa[0]?.at(-1), "Helmet");
    assert.equal(aoa[1]?.at(-1), "M");
  });
});

describe("driversExportCsv", () => {
  it("quotes a cell that carries a comma", () => {
    const csv = driversExportCsv([["name"], ["Ali, Ahmed"]]);
    assert.equal(csv, 'name\n"Ali, Ahmed"');
  });
});
