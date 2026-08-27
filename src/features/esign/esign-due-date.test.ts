import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { effectiveEsignStatus, isEsignDueDateAllowed } from "./esign-due-date";

describe("isEsignDueDateAllowed", () => {
  it("allows an empty due date and today, rejects yesterday", () => {
    assert.equal(isEsignDueDateAllowed("", "2026-08-26"), true);
    assert.equal(isEsignDueDateAllowed("2026-08-26", "2026-08-26"), true);
    assert.equal(isEsignDueDateAllowed("2026-08-25", "2026-08-26"), false);
  });
});

describe("effectiveEsignStatus", () => {
  it("marks a pending row expired the day after its due date", () => {
    assert.equal(effectiveEsignStatus("pending", "2026-08-25", "2026-08-26"), "expired");
    assert.equal(effectiveEsignStatus("pending", "2026-08-26T00:00:00.000Z", "2026-08-26"), "pending");
    assert.equal(effectiveEsignStatus("signed", "2026-08-25", "2026-08-26"), "signed");
  });
});
