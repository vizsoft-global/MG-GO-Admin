import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FUEL_REFUND_REQUIRED_KINDS,
  attachmentsOf,
  fileNameFromKey,
  fuelRefundMissingKind,
} from "./driver-requests";

describe("fuelRefundMissingKind", () => {
  it("requires cash_invoice, vehicle_photo and odometer", () => {
    assert.deepEqual([...FUEL_REFUND_REQUIRED_KINDS], [
      "cash_invoice",
      "vehicle_photo",
      "odometer",
    ]);
    assert.equal(fuelRefundMissingKind([]), "cash_invoice");
    assert.equal(
      fuelRefundMissingKind([{ kind: "cash_invoice" }, { kind: "vehicle_photo" }]),
      "odometer",
    );
    assert.equal(
      fuelRefundMissingKind([
        { kind: "cash_invoice" },
        { kind: "vehicle_photo" },
        { kind: "odometer" },
      ]),
      null,
    );
  });

  it("does not require rejected_fuel_invoice", () => {
    assert.equal(
      fuelRefundMissingKind([
        { kind: "cash_invoice" },
        { kind: "vehicle_photo" },
        { kind: "odometer" },
      ]),
      null,
    );
  });
});

describe("fileNameFromKey", () => {
  it("takes the last path segment", () => {
    assert.equal(fileNameFromKey("uid/req/photo.jpg"), "photo.jpg");
    assert.equal(fileNameFromKey("photo.jpg"), "photo.jpg");
  });
});

describe("attachmentsOf", () => {
  it("accepts p_attachments and camelCase", () => {
    assert.equal(attachmentsOf({ p_attachments: [{ kind: "odometer" }] }).length, 1);
    assert.equal(attachmentsOf({ attachments: [{ kind: "odometer" }] }).length, 1);
    assert.deepEqual(attachmentsOf({}), []);
  });
});
