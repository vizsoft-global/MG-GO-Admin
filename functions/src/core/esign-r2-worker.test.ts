import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { esignStorageConfigured } from "./esign-object-store";
import { esignWorkerConfig, isAllowedEsignWorkerKey } from "./esign-r2-worker";

describe("esignWorkerConfig", () => {
  it("requires the worker secret", () => {
    assert.equal(esignWorkerConfig({}), null);
    assert.equal(esignWorkerConfig({ ESIGN_R2_WORKER_URL: "https://example.test" }), null);
  });

  it("uses the default worker url when only the secret is set", () => {
    const config = esignWorkerConfig({ ESIGN_R2_WORKER_SECRET: "secret" });
    assert.deepEqual(config, {
      url: "https://dpd-esign-r2.vizsoft.workers.dev",
      secret: "secret",
    });
  });
});

describe("esignStorageConfigured", () => {
  it("accepts the worker secret when S3 keys are absent", () => {
    assert.equal(esignStorageConfigured({}), false);
    assert.equal(esignStorageConfigured({ ESIGN_R2_WORKER_SECRET: "secret" }), true);
  });
});

describe("isAllowedEsignWorkerKey", () => {
  it("accepts the esign prefix and refuses path escapes", () => {
    assert.equal(isAllowedEsignWorkerKey("esign-documents/admin/a.pdf"), true);
    assert.equal(isAllowedEsignWorkerKey("admin/a.pdf"), false);
    assert.equal(isAllowedEsignWorkerKey("esign-documents/../secret"), false);
  });
});
