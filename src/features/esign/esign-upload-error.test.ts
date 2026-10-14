import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyEsignUploadError } from "./esign-upload-error";
import { classifyEsignResolveError } from "./esign-resolve-error";

describe("missing bucket", () => {
  it("maps unset SDK to not_configured", () => {
    assert.equal(classifyEsignUploadError("not_configured"), "not_configured");
    assert.equal(classifyEsignUploadError(new Error("not_configured")), "not_configured");
    assert.equal(
      classifyEsignUploadError("Cloudflare R2 is not configured. Set R2_ACCOUNT_ID"),
      "not_configured",
    );
  });

  it("maps GCS missing-bucket text to storage_bucket_missing", () => {
    assert.equal(
      classifyEsignUploadError("The specified bucket does not exist."),
      "storage_bucket_missing",
    );
    assert.equal(
      classifyEsignUploadError({ message: "404 Bucket does not exist" }),
      "storage_bucket_missing",
    );
    assert.equal(classifyEsignUploadError("NoSuchBucket"), "storage_bucket_missing");
  });

  it("does not classify unknown_fn or unknown_id as a bucket miss", () => {
    assert.equal(classifyEsignUploadError("unknown_fn"), "upload_failed");
    assert.equal(classifyEsignUploadError(new Error("unknown_id")), "upload_failed");
    assert.equal(classifyEsignUploadError("wrong_lane"), "upload_failed");
  });
});

describe("unknown_fn", () => {
  it("maps empty / lane miss copy to unknown_fn", () => {
    assert.equal(classifyEsignResolveError("unknown_fn"), "unknown_fn");
    assert.equal(classifyEsignResolveError(new Error("not-found: unknown_fn")), "unknown_fn");
  });

  it("does not classify a bucket miss or unknown_id as unknown_fn", () => {
    assert.equal(classifyEsignResolveError("The specified bucket does not exist."), "failed");
    assert.equal(classifyEsignResolveError("storage_bucket_missing"), "failed");
    assert.equal(classifyEsignResolveError("unknown_id"), "unknown_id");
  });

  it("keeps employee misses on the row, not the router", () => {
    assert.equal(classifyEsignResolveError("ambiguous"), "ambiguous");
    assert.equal(classifyEsignResolveError("archived"), "archived");
    assert.equal(classifyEsignResolveError("blocked"), "blocked");
  });
});
