import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCheckInPhotoKeyForKey } from "../../../functions/src/rpcs/check-in-gate";
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

describe("buildDriverObjectKey check_in_photo", () => {
  it("uses a unique key per attempt instead of one key per rider per day", () => {
    // Two builds in the same tick — the old `${date}.jpg` shape returned the
    // identical key for both, which is what made the retry hit key_conflict.
    const first = buildDriverObjectKey({
      driverId: "rider-1",
      entityType: "check_in_photo",
      originalFilename: "check-in.jpg",
    });
    const second = buildDriverObjectKey({
      driverId: "rider-1",
      entityType: "check_in_photo",
      originalFilename: "check-in.jpg",
    });

    assert.ok(first);
    assert.ok(second);
    assert.notEqual(first, second);

    for (const key of [first!, second!]) {
      assert.match(key, /^drivers\/rider-1\/check_in\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.jpg$/);
      // The server binds the stored key to the rider prefix, so both attempts
      // have to satisfy the same gate.
      assert.equal(isCheckInPhotoKeyForKey("rider-1", key), true);
      assert.equal(isCheckInPhotoKeyForKey("rider-2", key), false);
    }
  });

  it("keeps the extension of the uploaded file", () => {
    const key = buildDriverObjectKey({
      driverId: "rider-1",
      entityType: "check_in_photo",
      originalFilename: "check-in.HEIC",
    });
    assert.match(key ?? "", /\.heic$/);
  });
});

describe("validateDriverUploadRequest check_in_photo", () => {
  it("accepts a JPEG under 5 MB", () => {
    const result = validateDriverUploadRequest({
      entityType: "check_in_photo",
      contentType: "image/jpeg",
      sizeBytes: 1024,
    });
    assert.deepEqual(result, { ok: true, entityType: "check_in_photo" });
  });

  it("rejects a PDF", () => {
    const result = validateDriverUploadRequest({
      entityType: "check_in_photo",
      contentType: "application/pdf",
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
