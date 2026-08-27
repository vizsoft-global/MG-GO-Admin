import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fuelFinalApproveBlocked,
  inclusiveDurationDays,
  isAssetFirstTime,
  shouldShowCreateField,
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
