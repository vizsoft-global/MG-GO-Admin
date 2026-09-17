import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachmentDisplayName } from "./attachment-display-name";

describe("attachmentDisplayName", () => {
  it("uses a short gallery name as-is", () => {
    assert.equal(attachmentDisplayName("invoice.pdf"), "invoice.pdf");
  });

  it("strips camera paths and collapsed space", () => {
    assert.equal(
      attachmentDisplayName("  /storage/emulated/0/DCIM/image.jpg  "),
      "image.jpg",
    );
    assert.equal(attachmentDisplayName("photo   name.png"), "photo name.png");
  });

  it("falls back to the storage key tail", () => {
    assert.equal(
      attachmentDisplayName("", "staff-id/req-id/123_capture.jpg"),
      "123_capture.jpg",
    );
  });
});
