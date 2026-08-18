import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dispatchToastCopy, dispatchToastKind } from "./dispatch-toast";

describe("dispatchToastKind", () => {
  it("treats hard FCM failures as an error toast, not success", () => {
    assert.equal(dispatchToastKind({ sent: 0, failed: 1, skipped: 0 }), "error");
  });

  it("warns when inbox was delivered but every push was a missing-token skip", () => {
    assert.equal(dispatchToastKind({ sent: 0, failed: 0, skipped: 1 }), "warning");
  });

  it("succeeds only when at least one push actually sent", () => {
    assert.equal(dispatchToastKind({ sent: 1, failed: 0, skipped: 0 }), "success");
  });

  it("maps hard failures onto sentPartial copy", () => {
    assert.deepEqual(dispatchToastCopy({ sent: 0, failed: 1, skipped: 0 }), {
      kind: "error",
      key: "sentPartial",
    });
  });
});
