import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { intakeMissingApprovalFields } from "./driver-approve-validation";
import { validateDriverForm } from "./driver-form-validation";
import { formatPhoneDisplay, NO_PHONE_DISPLAY } from "./driver-phone";
import {
  guessColumnMapping,
  mapRowsFromSheet,
  parseImportActive,
} from "./import/parse";
import {
  DRIVER_IMPORT_HEADERS,
  DRIVER_IMPORT_SAMPLE_ROW,
} from "./import/template";
import { DRIVER_IMPORT_REQUIRED_FIELDS } from "./types";
import type { DriverDocumentType } from "./types";

/**
 * Mobile number and civil ID are optional contact details, not credentials —
 * the driver app signs in with employee ID + a minted passcode. These cases pin
 * the two halves of that: a blank field is accepted everywhere, and a field
 * that was filled in is still held to its format.
 */

const noDocuments = {} as Record<DriverDocumentType, File | null>;

function formInput(overrides: Partial<Parameters<typeof validateDriverForm>[0]>) {
  return {
    fullName: "Ahmed Ali",
    phone: "99123456",
    civilId: "281010100001",
    employeeId: "12345",
    partnerId: "",
    zoneId: "",
    documents: noDocuments,
    ...overrides,
  };
}

describe("validateDriverForm — optional phone and civil ID", () => {
  it("accepts a driver with neither", () => {
    const errors = validateDriverForm(formInput({ phone: "", civilId: "" }));
    assert.deepEqual(errors, {});
  });

  it("still rejects a half-typed phone", () => {
    const errors = validateDriverForm(formInput({ phone: "9912" }));
    assert.equal(errors.phone, "invalid_phone");
  });

  it("still rejects a half-typed civil ID", () => {
    const errors = validateDriverForm(formInput({ civilId: "2810101" }));
    assert.equal(errors.civilId, "invalid_civil_id");
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
  };

  it("approves an intake with no phone and no civil ID", () => {
    assert.equal(
      intakeMissingApprovalFields({ ...base, phone: null, civil_id: null }),
      false,
    );
  });

  it("treats blank strings the same as absent", () => {
    assert.equal(
      intakeMissingApprovalFields({ ...base, phone: "   ", civil_id: "" }),
      false,
    );
  });

  it("refuses a malformed value that is present", () => {
    assert.equal(intakeMissingApprovalFields({ ...base, phone: "9912" }), true);
    assert.equal(intakeMissingApprovalFields({ ...base, civil_id: "281" }), true);
  });

  it("still requires name, driver code and employee ID", () => {
    assert.equal(intakeMissingApprovalFields({ ...base, full_name: "" }), true);
    assert.equal(intakeMissingApprovalFields({ ...base, driver_code: "" }), true);
    assert.equal(intakeMissingApprovalFields({ ...base, employee_id: null }), true);
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

describe("bulk import — phone and civil ID are no longer required columns", () => {
  it("does not force the operator to map them", () => {
    const required = [...DRIVER_IMPORT_REQUIRED_FIELDS] as string[];
    assert.ok(!required.includes("phone"));
    assert.ok(!required.includes("civil_id"));
    assert.deepEqual(required, ["full_name", "employee_id", "restaurant_ids"]);
  });

  it("still auto-maps them when the sheet has them", () => {
    const mapping = guessColumnMapping([...DRIVER_IMPORT_HEADERS]);
    assert.equal(mapping.phone, "Phone");
    assert.equal(mapping.civil_id, "Civil ID");
  });
});

describe("parseImportActive", () => {
  it("reads a blank cell as 'no opinion', not as no", () => {
    assert.equal(parseImportActive(""), null);
    assert.equal(parseImportActive(null), null);
    assert.equal(parseImportActive("   "), null);
  });

  it("accepts the spellings an operator actually types", () => {
    for (const yes of ["yes", "Yes", "Y", "TRUE", "1", "active", "approved"]) {
      assert.equal(parseImportActive(yes), true, yes);
    }
    for (const no of ["no", "N", "false", "0", "inactive", "pending"]) {
      assert.equal(parseImportActive(no), false, no);
    }
  });

  it("refuses anything else rather than silently not approving", () => {
    assert.equal(parseImportActive("maybe"), "invalid");
    assert.equal(parseImportActive("نعم"), "invalid");
  });
});

describe("mapRowsFromSheet — Active column", () => {
  const headers = [...DRIVER_IMPORT_HEADERS];
  const mapping = guessColumnMapping(headers);
  // Addressed by header rather than by position: the template's column order is
  // a presentation choice and has already been changed once.
  const columnAt = (header: string) => {
    const index = headers.indexOf(header);
    assert.notEqual(index, -1, `template has no ${header} column`);
    return index;
  };

  it("maps the Active cell from the template", () => {
    assert.equal(mapping.active, "Active");
    const [row] = mapRowsFromSheet(headers, [[...DRIVER_IMPORT_SAMPLE_ROW]], mapping);
    assert.equal(row!.active, "yes");
    assert.equal(row!.phone, "+96599123456");
    assert.equal(row!.civil_id, "281010100001");
  });

  it("keeps a row whose phone and civil ID cells are blank", () => {
    const blanked = [...DRIVER_IMPORT_SAMPLE_ROW];
    blanked[columnAt("Phone")] = "";
    blanked[columnAt("Civil ID")] = "";
    const [row] = mapRowsFromSheet(headers, [blanked], mapping);
    assert.equal(row!.phone, null);
    assert.equal(row!.civil_id, null);
    assert.equal(row!.full_name, "Ahmed Ali");
  });

  it("does not resurrect an empty row that only carries an Active cell", () => {
    const onlyActive = headers.map(() => "");
    onlyActive[columnAt("Active")] = "yes";
    assert.equal(mapRowsFromSheet(headers, [onlyActive], mapping).length, 0);
  });
});
