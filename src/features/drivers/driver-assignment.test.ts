import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasOpsAssignment, isAssignedZone } from "./driver-assignment";
import { NONE_ZONE, validateDriverForm } from "./driver-form-validation";
import type { DriverDocumentType } from "./types";

const noDocuments = {} as Record<DriverDocumentType, File | null>;

function form(overrides: Partial<Parameters<typeof validateDriverForm>[0]>) {
  return validateDriverForm({
    fullName: "Ahmed Ali",
    phone: "",
    civilId: "",
    employeeId: "12345",
    partnerId: "",
    zoneId: "",
    restaurantIds: [],
    documents: noDocuments,
    ...overrides,
  });
}

describe("isAssignedZone", () => {
  it("treats every spelling of empty as unassigned", () => {
    assert.equal(isAssignedZone(null), false);
    assert.equal(isAssignedZone(""), false);
    assert.equal(isAssignedZone("   "), false);
    assert.equal(isAssignedZone(NONE_ZONE), false);
  });

  it("accepts a real zone id", () => {
    assert.equal(isAssignedZone("zone-1"), true);
  });
});

describe("hasOpsAssignment", () => {
  it("accepts zone only, restaurant only, or both", () => {
    assert.equal(hasOpsAssignment("zone-1", []), true);
    assert.equal(hasOpsAssignment("", ["r1"]), true);
    assert.equal(hasOpsAssignment("zone-1", ["r1"]), true);
    assert.equal(hasOpsAssignment(null, 1), true);
  });

  it("refuses a driver with neither", () => {
    assert.equal(hasOpsAssignment("", []), false);
    assert.equal(hasOpsAssignment(NONE_ZONE, []), false);
    assert.equal(hasOpsAssignment(null, 0), false);
  });
});

describe("validateDriverForm — zone or restaurant", () => {
  it("refuses neither and accepts either side", () => {
    assert.equal(form({}).zoneId, "missing_assignment");
    assert.equal(form({}).restaurants, "missing_assignment");
    assert.equal(form({ zoneId: "zone-1" }).zoneId, undefined);
    assert.equal(form({ restaurantIds: ["r1"] }).restaurants, undefined);
  });
});
