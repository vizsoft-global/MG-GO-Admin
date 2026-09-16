import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createKindSpecs,
  isKnownCreateKind,
  missingRequiredCreateKind,
  typedRequiresAmount,
} from "./request-create-kinds";
import { createFormBlocked, typedRequiredPayloadKeys } from "./request-create-utils";

describe("createKindSpecs", () => {
  it("reuses the fleet catalogues and leaves rejected invoice optional", () => {
    assert.deepEqual(
      createKindSpecs("fuel").map((spec) => spec.kind),
      ["clear_fuel_invoice", "vehicle_plate"],
    );
    assert.equal(
      createKindSpecs("fuel").every((spec) => spec.required),
      true,
    );
    assert.deepEqual(
      createKindSpecs("fuel_refund").map((spec) => [spec.kind, spec.required]),
      [
        ["rejected_fuel_invoice", false],
        ["cash_invoice", true],
        ["vehicle_photo", true],
        ["odometer", true],
      ],
    );
    assert.deepEqual(createKindSpecs("asset"), []);
  });
});

describe("missingRequiredCreateKind", () => {
  it("returns the first missing required kind and ignores the optional rejected invoice", () => {
    assert.equal(missingRequiredCreateKind("fuel", []), "clear_fuel_invoice");
    assert.equal(missingRequiredCreateKind("fuel", ["clear_fuel_invoice"]), "vehicle_plate");
    assert.equal(
      missingRequiredCreateKind("fuel", ["clear_fuel_invoice", "vehicle_plate"]),
      null,
    );
    assert.equal(missingRequiredCreateKind("fuel_refund", []), "cash_invoice");
    assert.equal(
      missingRequiredCreateKind("fuel_refund", ["cash_invoice", "vehicle_photo", "odometer"]),
      null,
    );
    assert.equal(
      missingRequiredCreateKind("fuel_refund", [
        "rejected_fuel_invoice",
        "cash_invoice",
        "vehicle_photo",
      ]),
      "odometer",
    );
  });
});

describe("isKnownCreateKind", () => {
  it("accepts only the type's catalogue", () => {
    assert.equal(isKnownCreateKind("fuel", "clear_fuel_invoice"), true);
    assert.equal(isKnownCreateKind("fuel", "cash_invoice"), false);
    assert.equal(isKnownCreateKind("leave", "clear_fuel_invoice"), false);
  });
});

describe("typedRequiresAmount / fuel_refund reason", () => {
  it("requires amount on both fuel types and reason on refund", () => {
    assert.equal(typedRequiresAmount("fuel"), true);
    assert.equal(typedRequiresAmount("fuel_refund"), true);
    assert.equal(typedRequiresAmount("loan"), false);
    assert.deepEqual(typedRequiredPayloadKeys("fuel_refund", {}), ["reason"]);
    assert.deepEqual(typedRequiredPayloadKeys("fuel", {}), ["period_month"]);
  });
});

describe("createFormBlocked", () => {
  it("does not amber-gate fuel_refund after min_attachments became 3", () => {
    const options = {
      types: [
        { key: "fuel_refund", min_attachments: 3 },
        { key: "custom_photo", min_attachments: 2 },
      ],
      loanTenures: [{ months: 3 }],
      complaintCategories: [{ key: "pay" }],
    };
    assert.equal(createFormBlocked("fuel_refund", options), null);
    assert.equal(createFormBlocked("fuel", options), null);
    assert.equal(createFormBlocked("custom_photo", options), "attachments");
    assert.equal(createFormBlocked("sick_leave", options), "sickDocs");
  });
});
