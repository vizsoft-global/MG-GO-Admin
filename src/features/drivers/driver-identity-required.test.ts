import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  firstIdentityError,
  identityFieldError,
  identityFieldErrors,
  normalizeIdentity,
} from "./driver-identity-required";

/**
 * Civil ID, mobile and passport are mandatory on every write path.
 *
 * A blank is a *missing* field and a half-typed value is an *invalid* one; the
 * form and the server name the difference so the operator knows whether to type
 * something or fix something.
 */

describe("identityFieldError", () => {
  it("treats blank, whitespace and null as missing", () => {
    for (const field of ["civilId", "phone", "passport"] as const) {
      assert.equal(identityFieldError(field, ""), "missing_identity_fields");
      assert.equal(identityFieldError(field, "   "), "missing_identity_fields");
      assert.equal(identityFieldError(field, null), "missing_identity_fields");
    }
  });

  it("accepts the stored formats", () => {
    assert.equal(identityFieldError("civilId", "281010100001"), null);
    assert.equal(identityFieldError("phone", "99123456"), null);
    assert.equal(identityFieldError("phone", "+96599123456"), null);
    assert.equal(identityFieldError("passport", "p1234567"), null);
  });

  it("rejects a value that is present but malformed", () => {
    assert.equal(identityFieldError("civilId", "2810101"), "invalid_civil_id");
    assert.equal(identityFieldError("phone", "9912"), "invalid_phone");
    assert.equal(identityFieldError("passport", "P1"), "invalid_passport");
  });
});

describe("identityFieldErrors / firstIdentityError", () => {
  it("reports every failing field at once", () => {
    assert.deepEqual(identityFieldErrors({ civilId: "", phone: "12", passport: "P" }), {
      civilId: "missing_identity_fields",
      phone: "invalid_phone",
      passport: "invalid_passport",
    });
    assert.deepEqual(
      identityFieldErrors({ civilId: "281010100001", phone: "99123456", passport: "P1234567" }),
      {},
    );
  });

  it("focuses the first field in the order the card prints them", () => {
    assert.deepEqual(firstIdentityError({ civilId: "", phone: "", passport: "" }), {
      field: "civilId",
      code: "missing_identity_fields",
    });
    assert.deepEqual(
      firstIdentityError({ civilId: "281010100001", phone: "9912", passport: "P1" }),
      { field: "phone", code: "invalid_phone" },
    );
    assert.equal(
      firstIdentityError({ civilId: "281010100001", phone: "99123456", passport: "P1234567" }),
      null,
    );
  });
});

describe("normalizeIdentity", () => {
  it("normalises all three for a write", () => {
    const result = normalizeIdentity({
      civilId: " 281010100001 ",
      phone: "965 9912 3456",
      passport: " p1234567 ",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.civilId, "281010100001");
      assert.equal(result.value.phone, "+96599123456");
      assert.equal(result.value.passport, "P1234567");
    }
  });

  it("refuses with the field the operator has to fix", () => {
    const result = normalizeIdentity({
      civilId: "281010100001",
      phone: "99123456",
      passport: "",
    });
    assert.deepEqual(result, {
      ok: false,
      field: "passport",
      code: "missing_identity_fields",
    });
  });
});
