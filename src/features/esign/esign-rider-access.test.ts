import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  esignSignatureStoredKey,
  esignStorageKeyCandidates,
} from "./esign-rider-access";

describe("esignStorageKeyCandidates", () => {
  it("returns the stored key and the R2 folder form", () => {
    assert.deepEqual(esignStorageKeyCandidates("admin/abc.pdf"), [
      "admin/abc.pdf",
      "esign-documents/admin/abc.pdf",
    ]);
  });

  it("does not double the folder", () => {
    assert.deepEqual(esignStorageKeyCandidates("esign-documents/admin/abc.pdf"), [
      "admin/abc.pdf",
      "esign-documents/admin/abc.pdf",
    ]);
  });

  it("rejects traversal", () => {
    assert.deepEqual(esignStorageKeyCandidates("../secret.pdf"), []);
  });
});

describe("esignSignatureStoredKey", () => {
  it("matches the rider app key", () => {
    assert.equal(
      esignSignatureStoredKey("rider-1", "req-9"),
      "rider-1/req-9/signature.png",
    );
  });

  it("rejects a path-shaped id", () => {
    assert.equal(esignSignatureStoredKey("rider-1", "a/b"), null);
    assert.equal(esignSignatureStoredKey("rider-1", ".."), null);
  });
});
