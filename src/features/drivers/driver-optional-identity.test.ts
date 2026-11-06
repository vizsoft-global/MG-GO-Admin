import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { intakeMissingApprovalFields } from "./driver-approve-validation";
import { validateDriverForm } from "./driver-form-validation";
import { formatPhoneDisplay, NO_PHONE_DISPLAY } from "./driver-phone";
import { guessColumnMapping } from "./import/parse";
import { DRIVER_IMPORT_HEADERS } from "./import/template";
import { DRIVER_IMPORT_REQUIRED_FIELDS } from "./types";
import type { DriverDocumentType } from "./types";

/**
 * Civil ID, mobile number and passport are mandatory on every write path.
 *
 * These cases pin the three facts the operator is held to: a blank is refused by
 * name, a half-typed value is refused as invalid, and approval names the fields
 * a legacy record still owes. The bulk sheet marks the same three columns as
 * required so a new rider cannot be created without them.
 */

const noDocuments = {} as Record<DriverDocumentType, File | null>;

function formInput(overrides: Partial<Parameters<typeof validateDriverForm>[0]>) {
  return {
    fullName: "Ahmed Ali",
    phone: "99123456",
    civilId: "281010100001",
    passportNumber: "P1234567",
    employeeId: "12345",
    partnerId: "",
    zoneId: "zone-1",
    restaurantIds: [],
    documents: noDocuments,
    ...overrides,
  };
}

describe("validateDriverForm — identity is required", () => {
  it("accepts a complete driver", () => {
    assert.deepEqual(validateDriverForm(formInput({})), {});
  });

  it("refuses a blank phone or civil ID by name", () => {
    assert.equal(validateDriverForm(formInput({ phone: "" })).phone, "missing_fields");
    assert.equal(validateDriverForm(formInput({ civilId: "" })).civilId, "missing_fields");
  });

  it("refuses a blank passport", () => {
    assert.equal(
      validateDriverForm(formInput({ passportNumber: "" })).passportNumber,
      "missing_fields",
    );
  });

  it("refuses a half-typed value as invalid, not missing", () => {
    assert.equal(validateDriverForm(formInput({ phone: "9912" })).phone, "invalid_phone");
    assert.equal(
      validateDriverForm(formInput({ civilId: "2810101" })).civilId,
      "invalid_civil_id",
    );
    assert.equal(
      validateDriverForm(formInput({ passportNumber: "P12" })).passportNumber,
      "invalid_passport",
    );
  });

  it("keeps full name and employee ID mandatory", () => {
    assert.equal(validateDriverForm(formInput({ fullName: "" })).fullName, "missing_fields");
    assert.equal(
      validateDriverForm(formInput({ employeeId: "" })).employeeId,
      "missing_fields",
    );
  });
});

describe("intakeMissingApprovalFields", () => {
  const base = {
    phone: "+96599123456",
    full_name: "Ahmed Ali",
    driver_code: "10001",
    civil_id: "281010100001",
    employee_id: "12345",
    passport_number: "P1234567",
  };

  it("approves a complete intake", () => {
    assert.deepEqual(intakeMissingApprovalFields(base), []);
  });

  it("names every identity field a legacy intake still owes", () => {
    assert.deepEqual(
      intakeMissingApprovalFields({ ...base, phone: null, civil_id: null, passport_number: null }),
      ["civil_id", "phone", "passport_number"],
    );
    assert.deepEqual(
      intakeMissingApprovalFields({ ...base, phone: "   ", civil_id: "", passport_number: "" }),
      ["civil_id", "phone", "passport_number"],
    );
  });

  it("refuses a malformed value that is present", () => {
    assert.deepEqual(intakeMissingApprovalFields({ ...base, phone: "9912" }), ["phone"]);
    assert.deepEqual(intakeMissingApprovalFields({ ...base, civil_id: "281" }), ["civil_id"]);
    assert.deepEqual(
      intakeMissingApprovalFields({ ...base, passport_number: "P1" }),
      ["passport_number"],
    );
  });

  it("still requires name, driver code and employee ID", () => {
    assert.deepEqual(intakeMissingApprovalFields({ ...base, full_name: "" }), ["full_name"]);
    assert.deepEqual(intakeMissingApprovalFields({ ...base, driver_code: "" }), ["driver_code"]);
    assert.deepEqual(intakeMissingApprovalFields({ ...base, employee_id: null }), [
      "employee_id",
    ]);
  });
});

describe("formatPhoneDisplay", () => {
  it("renders an em dash rather than throwing on a missing number", () => {
    assert.equal(formatPhoneDisplay(null), NO_PHONE_DISPLAY);
    assert.equal(formatPhoneDisplay(""), NO_PHONE_DISPLAY);
    assert.equal(formatPhoneDisplay("   "), NO_PHONE_DISPLAY);
    assert.equal(formatPhoneDisplay("+96599123456"), "99123456");
  });
});

describe("bulk import — identity columns are required", () => {
  it("forces the operator to map all three", () => {
    const required = [...DRIVER_IMPORT_REQUIRED_FIELDS] as string[];
    assert.ok(required.includes("phone"));
    assert.ok(required.includes("civil_id"));
    assert.ok(required.includes("passport_number"));
    assert.ok(!required.includes("restaurant_ids"));
  });

  it("still auto-maps them from the template headings", () => {
    const mapping = guessColumnMapping([...DRIVER_IMPORT_HEADERS]);
    assert.equal(mapping.phone, "Phone");
    assert.equal(mapping.civil_id, "Civil ID");
    assert.equal(mapping.passport_number, "Passport");
  });
});
