import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pendingUploadDecision } from "./pending-upload-decision";

const CALLER = "rider-1";

describe("pendingUploadDecision", () => {
  it("creates a row when nothing is stored under the key", () => {
    assert.equal(pendingUploadDecision(null, { uploadedBy: CALLER }), "create");
    assert.equal(pendingUploadDecision(undefined, { uploadedBy: CALLER }), "create");
  });

  it("reuses the caller's own pending row on a genuine retry", () => {
    assert.equal(
      pendingUploadDecision({ status: "pending", uploaded_by: CALLER }, { uploadedBy: CALLER }),
      "reuse",
    );
  });

  it("refuses a row that belongs to another uploader", () => {
    assert.equal(
      pendingUploadDecision({ status: "pending", uploaded_by: "rider-2" }, { uploadedBy: CALLER }),
      "conflict",
    );
    assert.equal(
      pendingUploadDecision({ status: "pending", uploaded_by: null }, { uploadedBy: CALLER }),
      "conflict",
    );
  });

  it("refuses a row that is no longer pending", () => {
    for (const status of ["completed", "failed", "expired"]) {
      assert.equal(
        pendingUploadDecision({ status, uploaded_by: CALLER }, { uploadedBy: CALLER }),
        "conflict",
      );
    }
    assert.equal(pendingUploadDecision({ uploaded_by: CALLER }, { uploadedBy: CALLER }), "conflict");
  });
});
