import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ESIGN_ATTACHMENT_CAP,
  canAddEsignAttachment,
  esignAttachmentPath,
  isOwnRiderAttachmentKey,
} from "./esign-attachments";

describe("esign attachments", () => {
  it("caps a request at five documents", () => {
    assert.equal(ESIGN_ATTACHMENT_CAP, 5);
    assert.equal(canAddEsignAttachment(0), true);
    assert.equal(canAddEsignAttachment(4), true);
    assert.equal(canAddEsignAttachment(5), false);
    assert.equal(canAddEsignAttachment(6), false);
  });

  it("accepts only the rider's own key and never traversal", () => {
    assert.equal(isOwnRiderAttachmentKey("uid-1", "uid-1/esign-attachments/a.pdf"), true);
    assert.equal(isOwnRiderAttachmentKey("uid-1", "uid-2/esign-attachments/a.pdf"), false);
    assert.equal(isOwnRiderAttachmentKey("uid-1", "uid-1/../uid-2/a.pdf"), false);
    assert.equal(isOwnRiderAttachmentKey("uid-1", "/uid-1/a.pdf"), false);
    assert.equal(isOwnRiderAttachmentKey("", "uid-1/a.pdf"), false);
  });

  it("prefixes the eSign bucket once", () => {
    assert.equal(esignAttachmentPath("uid-1/a.pdf"), "esign-documents/uid-1/a.pdf");
    assert.equal(esignAttachmentPath("/uid-1/a.pdf"), "esign-documents/uid-1/a.pdf");
  });
});
