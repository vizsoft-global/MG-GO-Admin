import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_SERVICE_ATTACHMENTS,
  MAX_SERVICE_ATTACHMENT_BYTES,
  formatAttachmentSize,
  isAllowedServiceMime,
  normaliseServiceAttachments,
  serviceAttachmentKeyPrefix,
  serviceAttachmentKeyProblem,
  serviceUploadBlockReason,
} from "./service-attachments-model";

const VEHICLE = "veh-1";
const GOOD_KEY = `vehicles/${VEHICLE}/service/0b6f2f9a-1c3d-4f5e-8a9b-000000000000.pdf`;

describe("service attachment upload rules", () => {
  it("allows images and PDFs only", () => {
    assert.equal(isAllowedServiceMime("image/jpeg"), true);
    assert.equal(isAllowedServiceMime("image/png"), true);
    assert.equal(isAllowedServiceMime("application/pdf"), true);
    assert.equal(isAllowedServiceMime("video/mp4"), false);
    assert.equal(isAllowedServiceMime(""), false);
  });

  it("refuses a file before it is uploaded", () => {
    assert.equal(
      serviceUploadBlockReason({ size: 1024, contentType: "image/jpeg", existingCount: 0 }),
      null,
    );
    assert.equal(
      serviceUploadBlockReason({ size: 0, contentType: "image/jpeg", existingCount: 0 }),
      "file_empty",
    );
    assert.equal(
      serviceUploadBlockReason({
        size: MAX_SERVICE_ATTACHMENT_BYTES + 1,
        contentType: "image/jpeg",
        existingCount: 0,
      }),
      "file_too_large",
    );
    assert.equal(
      serviceUploadBlockReason({ size: 1024, contentType: "video/mp4", existingCount: 0 }),
      "invalid_content_type",
    );
    assert.equal(
      serviceUploadBlockReason({
        size: 1024,
        contentType: "application/pdf",
        existingCount: MAX_SERVICE_ATTACHMENTS,
      }),
      "too_many_attachments",
    );
  });

  it("keeps every key inside the record's own vehicle", () => {
    assert.equal(serviceAttachmentKeyPrefix(VEHICLE), `vehicles/${VEHICLE}/service/`);
    assert.equal(serviceAttachmentKeyProblem(GOOD_KEY, { vehicleId: VEHICLE }), null);
    // Another plate, a driver document, an accident photo — all refused, because
    // the signed-URL door would otherwise sign them for a service-only account.
    assert.equal(
      serviceAttachmentKeyProblem(`vehicles/other/service/x.pdf`, { vehicleId: VEHICLE }),
      "foreign_attachment",
    );
    assert.equal(
      serviceAttachmentKeyProblem(`drivers/abc/service/x.pdf`, { vehicleId: VEHICLE }),
      "foreign_attachment",
    );
    assert.equal(
      serviceAttachmentKeyProblem(`vehicles/${VEHICLE}/accidents/x.pdf`, { vehicleId: VEHICLE }),
      "foreign_attachment",
    );
    assert.equal(serviceAttachmentKeyProblem("", { vehicleId: VEHICLE }), "invalid_attachment");
    assert.equal(
      serviceAttachmentKeyProblem(`vehicles/${VEHICLE}/service/../x.pdf`, { vehicleId: VEHICLE }),
      "invalid_attachment",
    );
    assert.equal(serviceAttachmentKeyProblem(GOOD_KEY, { vehicleId: "" }), "invalid_attachment");
  });
});

describe("service attachment parsing", () => {
  it("reads stored rows and drops duplicates and blank keys", () => {
    const parsed = normaliseServiceAttachments([
      { key: GOOD_KEY, file_name: "invoice.pdf", content_type: "application/pdf", size: 1234 },
      { key: GOOD_KEY, file_name: "again.pdf" },
      { key: "  ", file_name: "ghost.pdf" },
      null,
      { file_name: "no-key.pdf" },
    ]);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.key, GOOD_KEY);
    assert.equal(parsed[0]?.file_name, "invoice.pdf");
    assert.equal(parsed[0]?.size, 1234);
    assert.equal(parsed[0]?.kind, null);
  });

  it("treats a legacy row with no attachments as none", () => {
    assert.deepEqual(normaliseServiceAttachments(undefined), []);
    assert.deepEqual(normaliseServiceAttachments({ key: GOOD_KEY }), []);
  });

  it("prints a size a person can read", () => {
    assert.equal(formatAttachmentSize(null), "");
    assert.equal(formatAttachmentSize(0), "");
    assert.equal(formatAttachmentSize(820 * 1024), "820 KB");
    assert.equal(formatAttachmentSize(1.4 * 1024 * 1024), "1.4 MB");
  });
});
