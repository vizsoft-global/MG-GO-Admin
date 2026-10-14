import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ESIGN_R2_WORKER_URL,
  esignR2WorkerConfig,
  esignStorageBackend,
  isAllowedEsignR2WorkerKey,
  signEsignReadGrant,
  verifyEsignReadGrant,
} from "./esign-r2-worker";

describe("esignR2WorkerConfig", () => {
  it("requires a secret and defaults the public Worker URL", () => {
    assert.equal(esignR2WorkerConfig({}), null);
    assert.equal(esignR2WorkerConfig({ ESIGN_R2_WORKER_URL: "https://x.example" }), null);
    assert.deepEqual(esignR2WorkerConfig({ ESIGN_R2_WORKER_SECRET: "s" }), {
      url: DEFAULT_ESIGN_R2_WORKER_URL,
      secret: "s",
    });
    assert.deepEqual(
      esignR2WorkerConfig({
        ESIGN_R2_WORKER_URL: "https://dpd-esign-r2.vizsoft.workers.dev/",
        ESIGN_R2_WORKER_SECRET: "secret",
      }),
      { url: "https://dpd-esign-r2.vizsoft.workers.dev", secret: "secret" },
    );
  });
});

describe("esignStorageBackend", () => {
  it("prefers S3 when access keys exist, else Worker, else none", () => {
    assert.equal(esignStorageBackend({}), null);
    assert.equal(
      esignStorageBackend({
        R2_ACCOUNT_ID: "a",
        R2_BUCKET_NAME: "b",
        ESIGN_R2_WORKER_SECRET: "s",
      }),
      "worker",
    );
    assert.equal(
      esignStorageBackend({
        R2_ACCOUNT_ID: "a",
        R2_ACCESS_KEY_ID: "k",
        R2_SECRET_ACCESS_KEY: "sec",
        R2_BUCKET_NAME: "b",
        ESIGN_R2_WORKER_SECRET: "s",
      }),
      "s3",
    );
  });
});

describe("esign read grant", () => {
  it("accepts a fresh signature and rejects a stale or wrong one", () => {
    const exp = Date.now() + 60_000;
    const sig = signEsignReadGrant({ key: "esign-documents/a.pdf", exp, secret: "s" });
    assert.equal(
      verifyEsignReadGrant({ key: "esign-documents/a.pdf", exp, sig, secret: "s" }),
      true,
    );
    assert.equal(
      verifyEsignReadGrant({
        key: "esign-documents/a.pdf",
        exp: Date.now() - 1,
        sig,
        secret: "s",
      }),
      false,
    );
    assert.equal(
      verifyEsignReadGrant({ key: "esign-documents/other.pdf", exp, sig, secret: "s" }),
      false,
    );
  });
});

describe("isAllowedEsignR2WorkerKey", () => {
  it("allows only the esign-documents folder", () => {
    assert.equal(isAllowedEsignR2WorkerKey("esign-documents/admin/a.pdf"), true);
    assert.equal(isAllowedEsignR2WorkerKey("drivers/x"), false);
    assert.equal(isAllowedEsignR2WorkerKey("esign-documents/../secret"), false);
  });
});
