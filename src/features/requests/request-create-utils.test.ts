import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fuelFinalApproveBlocked,
  inclusiveDurationDays,
  isAssetFirstTime,
  isNeededByInPast,
  parseCreateRequestError,
  shouldShowCreateField,
  staticOptionsForField,
  typedRequiredPayloadKeys,
  typeUsesDateRange,
} from "./request-create-utils";

describe("typeUsesDateRange", () => {
  it("shows a date picker for leave even when the field key is date_range", () => {
    assert.equal(typeUsesDateRange("leave", [{ key: "date_range" }]), true);
    assert.equal(typeUsesDateRange("fuel", [{ key: "period_month" }]), false);
  });
});

describe("asset current status", () => {
  it("hides Lost/Damaged when the mode is First Time", () => {
    assert.equal(isAssetFirstTime("First Time"), true);
    assert.equal(shouldShowCreateField("asset_current_status", { request_mode: "First Time" }), false);
    assert.equal(shouldShowCreateField("asset_current_status", { request_mode: "Renewal" }), true);
  });

  it("does not require current status on a first-time request", () => {
    assert.ok(!typedRequiredPayloadKeys("asset", { request_mode: "First Time" }).includes("asset_current_status"));
    assert.ok(typedRequiredPayloadKeys("asset", { request_mode: "Renewal" }).includes("asset_current_status"));
  });
});

describe("inclusiveDurationDays", () => {
  it("counts both ends of the range", () => {
    assert.equal(inclusiveDurationDays("2026-08-25", "2026-08-25"), 1);
    assert.equal(inclusiveDurationDays("2026-08-25", "2026-08-27"), 3);
  });
});

describe("fuelFinalApproveBlocked", () => {
  it("blocks only the last fuel approve when transfer type is missing", () => {
    assert.equal(
      fuelFinalApproveBlocked({
        requestType: "fuel",
        fuelTransferType: null,
        isFinalStep: true,
      }),
      true,
    );
    assert.equal(
      fuelFinalApproveBlocked({
        requestType: "fuel",
        fuelTransferType: "cash",
        isFinalStep: true,
      }),
      false,
    );
    assert.equal(
      fuelFinalApproveBlocked({
        requestType: "fuel",
        fuelTransferType: null,
        isFinalStep: false,
      }),
      false,
    );
  });
});

describe("staticOptionsForField", () => {
  it("returns the server list the create RPC will accept", () => {
    assert.deepEqual(
      staticOptionsForField("leave_type", [
        { field_key: "leave_type", options: ["Annual", "Emergency", "Accident", "Unpaid Leave"] },
      ]),
      ["Annual", "Emergency", "Accident", "Unpaid Leave"],
    );
    assert.deepEqual(
      staticOptionsForField("asset_type", []),
      [
        "SIM card",
        "Fuel card",
        "Fuel limit change",
        "Raincoat",
        "Delivery bag",
        "Reflective vest",
        "Winter jacket",
        "Delivery attire",
        "Delivery pants",
        "New bike",
        "Helmet",
        "Delivery box",
        "Fuel chip",
        "Phone",
        "Mobile holder",
      ],
    );
  });
});

describe("parseCreateRequestError", () => {
  it("does not treat invalid_option:leave_type as an i18n path", () => {
    assert.deepEqual(parseCreateRequestError("invalid_option:leave_type"), {
      key: "invalid_option",
      field: "leave_type",
    });
    assert.deepEqual(parseCreateRequestError("invalid_option:asset_type"), {
      key: "invalid_option",
      field: "asset_type",
    });
    assert.equal(parseCreateRequestError("tenure_required").key, "tenure_required");
  });
});

describe("isNeededByInPast", () => {
  it("refuses a needed-by before Kuwait today", () => {
    assert.equal(isNeededByInPast("2026-08-20", "2026-08-28"), true);
    assert.equal(isNeededByInPast("2026-08-28", "2026-08-28"), false);
    assert.equal(isNeededByInPast("2026-09-01", "2026-08-28"), false);
  });
});
