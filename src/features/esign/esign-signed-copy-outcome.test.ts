import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AWAITING_COUNTER_SIGNATURE,
  signedCopyOutcome,
} from "./esign-signed-copy-outcome";

describe("signedCopyOutcome", () => {
  it("is ready when the compose wrote the copy", () => {
    assert.deepEqual(
      signedCopyOutcome({ error: null, data: { ok: true, storage_key: "signed/x.pdf" } }),
      { status: "ready" },
    );
  });

  it("reports the counter-signature wait instead of a missing document", () => {
    assert.deepEqual(
      signedCopyOutcome({
        error: null,
        data: { ok: false, error: AWAITING_COUNTER_SIGNATURE },
      }),
      { status: "awaiting" },
    );
  });

  it("passes any other compose refusal through", () => {
    assert.deepEqual(
      signedCopyOutcome({ error: null, data: { ok: false, error: "staff_slot_missing" } }),
      { status: "failed", error: "staff_slot_missing" },
    );
    assert.deepEqual(
      signedCopyOutcome({ error: null, data: { ok: false } }),
      { status: "failed", error: "compose_failed" },
    );
  });

  it("treats a callable error as a failure, not as ready", () => {
    assert.deepEqual(
      signedCopyOutcome({ error: { message: "not_authenticated" }, data: null }),
      { status: "failed", error: "not_authenticated" },
    );
  });
});
