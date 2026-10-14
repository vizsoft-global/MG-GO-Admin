import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  esignDocumentHref,
  esignObjectPath,
  normalizeEsignStorageKey,
} from "./esign-storage-key";

describe("normalizeEsignStorageKey", () => {
  it("strips a leading bucket prefix", () => {
    assert.equal(
      normalizeEsignStorageKey("esign-documents/admin/abc.pdf"),
      "admin/abc.pdf",
    );
  });

  it("leaves a bare object key unchanged", () => {
    assert.equal(normalizeEsignStorageKey("admin/abc.pdf"), "admin/abc.pdf");
  });
});

describe("esignObjectPath", () => {
  it("prefixes the R2 folder once", () => {
    assert.equal(esignObjectPath("admin/abc.pdf"), "esign-documents/admin/abc.pdf");
    assert.equal(
      esignObjectPath("esign-documents/admin/abc.pdf"),
      "esign-documents/admin/abc.pdf",
    );
  });
});

describe("esignDocumentHref", () => {
  it("builds a same-origin download URL", () => {
    assert.equal(
      esignDocumentHref("req-1", "signed"),
      "/api/esign/document-download?id=req-1&kind=signed&disposition=attachment",
    );
  });
});
