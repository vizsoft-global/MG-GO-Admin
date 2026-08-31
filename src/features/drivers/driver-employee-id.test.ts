import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValidEmployeeId, normalizeEmployeeId } from "./driver-errors";
import { validateDriverForm } from "./driver-form-validation";
import type { DriverDocumentType } from "./types";

const noDocuments = {} as Record<DriverDocumentType, File | null>;

describe("normalizeEmployeeId", () => {
  it("accepts letters, digits, and a 100-character value", () => {
    assert.equal(normalizeEmployeeId("EMP123"), "EMP123");
    assert.equal(normalizeEmployeeId("  abc99  "), "abc99");
    assert.equal(normalizeEmployeeId("12345"), "12345");
    assert.equal(normalizeEmployeeId("A".repeat(100)), "A".repeat(100));
  });

  it("refuses empty, over-long, and punctuation", () => {
    assert.equal(normalizeEmployeeId(""), null);
    assert.equal(normalizeEmployeeId("   "), null);
    assert.equal(normalizeEmployeeId("A".repeat(101)), null);
    assert.equal(normalizeEmployeeId("EMP-123"), null);
    assert.equal(normalizeEmployeeId("emp 123"), null);
  });

  it("treats 4–8 digits as still valid", () => {
    assert.equal(isValidEmployeeId("1234"), true);
    assert.equal(isValidEmployeeId("12345678"), true);
  });
});

describe("validateDriverForm — employee ID", () => {
  it("accepts an alphanumeric employee ID", () => {
    const errors = validateDriverForm({
      fullName: "Ahmed Ali",
      phone: "",
      civilId: "",
      employeeId: "EMP2048",
      partnerId: "",
      zoneId: "zone-1",
      restaurantIds: [],
      documents: noDocuments,
    });
    assert.equal(errors.employeeId, undefined);
  });

  it("refuses punctuation and a 101-character value", () => {
    assert.equal(
      validateDriverForm({
        fullName: "Ahmed Ali",
        phone: "",
        civilId: "",
        employeeId: "EMP-2048",
        partnerId: "",
        zoneId: "zone-1",
        restaurantIds: [],
        documents: noDocuments,
      }).employeeId,
      "employee_id_format",
    );
    assert.equal(
      validateDriverForm({
        fullName: "Ahmed Ali",
        phone: "",
        civilId: "",
        employeeId: "A".repeat(101),
        partnerId: "",
        zoneId: "zone-1",
        restaurantIds: [],
        documents: noDocuments,
      }).employeeId,
      "employee_id_format",
    );
  });
});
