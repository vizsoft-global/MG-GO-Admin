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

describe("validateDriverUploadRequest request_attachment", () => {
  it("accepts a JPEG under 10 MB", () => {
    const result = validateDriverUploadRequest({
      entityType: "request_attachment",
      contentType: "image/jpeg",
      sizeBytes: 1024,
    });
    assert.deepEqual(result, { ok: true, entityType: "request_attachment" });
  });

  it("accepts a PDF", () => {
    const result = validateDriverUploadRequest({
      entityType: "request_attachment",
      contentType: "application/pdf",
      sizeBytes: 2048,
    });
    assert.deepEqual(result, { ok: true, entityType: "request_attachment" });
  });
});

describe("buildDriverObjectKey request_attachment", () => {
  it("uses the drivers request_attachment prefix", () => {
    const key = buildDriverObjectKey({
      driverId: "rider-1",
      entityType: "request_attachment",
      originalFilename: "invoice.jpg",
    });
    assert.match(
      key ?? "",
      /^drivers\/rider-1\/request_attachment\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.jpg$/,
    );
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
