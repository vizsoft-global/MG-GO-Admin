import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyEsignResolveError,
  mappedEsignErrorKey,
} from "./esign-resolve-error";
import { classifyEsignUploadError } from "./esign-upload-error";

describe("unknown_fn isolate", () => {
  it("maps empty fn and lane miss, not a bucket or unknown_id", () => {
    assert.equal(classifyEsignResolveError("unknown_fn"), "unknown_fn");
    assert.equal(classifyEsignResolveError("wrong_lane"), "wrong_lane");
    assert.equal(classifyEsignResolveError("unknown_id"), "unknown_id");
    assert.equal(classifyEsignResolveError("The specified bucket does not exist"), "failed");
    assert.notEqual(classifyEsignResolveError("unknown_fn"), "unknown_id");
    assert.notEqual(classifyEsignUploadError("unknown_fn"), "storage_bucket_missing");
    assert.equal(mappedEsignErrorKey("unknown_fn"), "unknown_fn");
    assert.equal(mappedEsignErrorKey("storage_bucket_missing"), "storage_bucket_missing");
    assert.equal(mappedEsignErrorKey("garbage"), null);
  });
});
