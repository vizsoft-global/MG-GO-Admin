import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isEsignDueDateAllowed } from "./esign-due-date";

describe("isEsignDueDateAllowed", () => {
  it("allows an empty due date", () => {
    assert.equal(isEsignDueDateAllowed("", "2026-08-25"), true);
  });

  it("allows today and future dates", () => {
    assert.equal(isEsignDueDateAllowed("2026-08-25", "2026-08-25"), true);
    assert.equal(isEsignDueDateAllowed("2026-08-26", "2026-08-25"), true);
  });

  it("rejects a past date", () => {
    assert.equal(isEsignDueDateAllowed("2026-08-24", "2026-08-25"), false);
  });
});
