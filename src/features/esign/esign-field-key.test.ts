import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ESIGN_RESERVED_FIELD_KEYS,
  isWritableEsignFieldKey,
  type EsignFieldSource,
} from "./types";

const SOURCES: EsignFieldSource[] = ["system", "entry", "fixed", "signature"];

describe("isWritableEsignFieldKey", () => {
  it("lets a reserved employee-block key persist only as a system row", () => {
    for (const key of ESIGN_RESERVED_FIELD_KEYS) {
      assert.equal(isWritableEsignFieldKey(key, "system"), true, `${key} system`);
      assert.equal(isWritableEsignFieldKey(key, "entry"), false, `${key} entry`);
      assert.equal(isWritableEsignFieldKey(key, "fixed"), false, `${key} fixed`);
      assert.equal(isWritableEsignFieldKey(key, "signature"), false, `${key} signature`);
      assert.equal(isWritableEsignFieldKey(key), false, `${key} default`);
    }
  });

  it("accepts a custom snake_case key for every source", () => {
    for (const source of SOURCES) {
      assert.equal(isWritableEsignFieldKey("penalty_type", source), true);
      assert.equal(isWritableEsignFieldKey("civil_id", source), true);
    }
  });

  it("refuses a key that is not snake_case starting with a letter", () => {
    assert.equal(isWritableEsignFieldKey(""), false);
    assert.equal(isWritableEsignFieldKey("EmployeeName", "system"), false);
    assert.equal(isWritableEsignFieldKey("1employee", "system"), false);
    assert.equal(isWritableEsignFieldKey("employee-name", "system"), false);
  });
});
