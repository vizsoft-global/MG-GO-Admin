import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accidentAttachmentKeyProblem,
  accidentUploadBlockReason,
  isAllowedAccidentMime,
  riderAccidentKeyPrefix,
} from "./accident-attachment-rules";
import { buildDriverObjectKey, validateDriverUploadRequest } from "@/lib/storage/driver-upload-keys";
import { MAX_ACCIDENT_ATTACHMENTS, MAX_ACCIDENT_ATTACHMENT_BYTES } from "./accident-types";

const RIDER = "9JfM0181bxQBjaZRuBhL58Tb4Gy1";

describe("accident attachment key", () => {
  it("builds the rider prefix per rider", () => {
    const key = buildDriverObjectKey({
      driverId: RIDER,
      entityType: "accident_attachment",
      originalFilename: "damage.JPG",
    });
    assert.ok(key);
    assert.equal(
      key!.startsWith(`drivers/${RIDER}/accident_attachment/`),
      true,
    );
    assert.equal(key!.endsWith(".jpg"), true);
    assert.equal(key, riderAccidentKeyPrefix(RIDER) + key!.split("/").slice(-2).join("/"));
  });

  it("gives every attempt its own key, so a retry cannot collide", () => {
    const first = buildDriverObjectKey({
      driverId: RIDER,
      entityType: "accident_attachment",
      originalFilename: "a.jpg",
    });
    const second = buildDriverObjectKey({
      driverId: RIDER,
      entityType: "accident_attachment",
      originalFilename: "a.jpg",
    });
    assert.notEqual(first, second);
  });

  it("accepts this rider's key and refuses a foreign one", () => {
    const own = `${riderAccidentKeyPrefix(RIDER)}2026-11-02/abc.jpg`;
    assert.equal(accidentAttachmentKeyProblem(own), null);
    assert.equal(accidentAttachmentKeyProblem(own, { driverId: RIDER }), null);

    const foreign = `${riderAccidentKeyPrefix("another-rider")}2026-11-02/abc.jpg`;
    assert.equal(accidentAttachmentKeyProblem(foreign, { driverId: RIDER }), "foreign_key");
    // An admin key is not a rider key either.
    assert.equal(
      accidentAttachmentKeyProblem("vehicles/veh-1/accidents/abc.jpg", { driverId: RIDER }),
      "foreign_key",
    );
  });

  it("refuses a key another case already claimed", () => {
    const own = `${riderAccidentKeyPrefix(RIDER)}2026-11-02/abc.jpg`;
    assert.equal(
      accidentAttachmentKeyProblem(own, { driverId: RIDER, claimedKeys: [own] }),
      "attachment_claimed",
    );
  });

  it("refuses traversal, an empty key and a path outside the two roots", () => {
    assert.equal(accidentAttachmentKeyProblem(""), "invalid_attachment");
    assert.equal(accidentAttachmentKeyProblem("drivers/x/accident_attachment/../../y"), "invalid_attachment");
    assert.equal(accidentAttachmentKeyProblem("/drivers/x/a.jpg"), "invalid_attachment");
    assert.equal(accidentAttachmentKeyProblem("notifications/assets/a.jpg"), "invalid_attachment");
  });
});

describe("accident attachment limits", () => {
  it("accepts images, PDF, MP4 and MOV only", () => {
    assert.equal(isAllowedAccidentMime("image/jpeg"), true);
    assert.equal(isAllowedAccidentMime("IMAGE/PNG"), true);
    assert.equal(isAllowedAccidentMime("application/pdf"), true);
    assert.equal(isAllowedAccidentMime("video/mp4"), true);
    assert.equal(isAllowedAccidentMime("video/quicktime"), true);
    assert.equal(isAllowedAccidentMime("video/webm"), false);
    assert.equal(isAllowedAccidentMime("text/plain"), false);
    assert.equal(isAllowedAccidentMime(""), false);
  });

  it("caps one file at 50 MB and one case at 10 files", () => {
    const base = { size: 1024, contentType: "image/jpeg", existingCount: 0 };
    assert.equal(accidentUploadBlockReason(base), null);
    assert.equal(
      accidentUploadBlockReason({ ...base, size: MAX_ACCIDENT_ATTACHMENT_BYTES }),
      null,
    );
    assert.equal(
      accidentUploadBlockReason({ ...base, size: MAX_ACCIDENT_ATTACHMENT_BYTES + 1 }),
      "file_too_large",
    );
    assert.equal(
      accidentUploadBlockReason({ ...base, existingCount: MAX_ACCIDENT_ATTACHMENTS }),
      "too_many_attachments",
    );
    assert.equal(accidentUploadBlockReason({ ...base, size: 0 }), "file_empty");
    assert.equal(
      accidentUploadBlockReason({ ...base, contentType: "video/webm" }),
      "invalid_content_type",
    );
  });

  it("enforces the same numbers on the presign side", () => {
    const ok = validateDriverUploadRequest({
      entityType: "accident_attachment",
      contentType: "video/mp4",
      sizeBytes: MAX_ACCIDENT_ATTACHMENT_BYTES,
    });
    assert.equal("ok" in ok, true);

    const tooBig = validateDriverUploadRequest({
      entityType: "accident_attachment",
      contentType: "image/jpeg",
      sizeBytes: MAX_ACCIDENT_ATTACHMENT_BYTES + 1,
    });
    assert.equal("error" in tooBig && tooBig.error, "file_too_large");

    const badType = validateDriverUploadRequest({
      entityType: "accident_attachment",
      contentType: "video/webm",
      sizeBytes: 1024,
    });
    assert.equal("error" in badType && badType.error, "invalid_content_type");
  });
});
