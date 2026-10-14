import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDriverObjectKey,
  validateDriverUploadRequest,
} from "./driver-upload-keys";

describe("validateDriverUploadRequest esign_signature", () => {
  it("accepts a PNG under 4 MB", () => {
    const result = validateDriverUploadRequest({
      entityType: "esign_signature",
      contentType: "image/png",
      sizeBytes: 1024,
    });
    assert.deepEqual(result, { ok: true, entityType: "esign_signature" });
  });

  it("rejects JPEG", () => {
    const result = validateDriverUploadRequest({
      entityType: "esign_signature",
      contentType: "image/jpeg",
      sizeBytes: 1024,
    });
    assert.deepEqual(result, { error: "invalid_content_type" });
  });
});

describe("buildDriverObjectKey esign_signature", () => {
  it("uses the stored rider key", () => {
    assert.equal(
      buildDriverObjectKey({
        driverId: "rider-1",
        entityType: "esign_signature",
        originalFilename: "sig.png",
        entityId: "req-9",
      }),
      "rider-1/req-9/signature.png",
    );
  });

  it("returns null for a path-shaped request id", () => {
    assert.equal(
      buildDriverObjectKey({
        driverId: "rider-1",
        entityType: "esign_signature",
        originalFilename: "sig.png",
        entityId: "a/b",
      }),
      null,
    );
  });
});
