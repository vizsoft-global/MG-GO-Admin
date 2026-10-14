import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { r2ConfigFromEnv } from "./r2-esign";

describe("r2ConfigFromEnv", () => {
  it("returns null when any R2 key is missing", () => {
    assert.equal(r2ConfigFromEnv({}), null);
    assert.equal(
      r2ConfigFromEnv({
        R2_ACCOUNT_ID: "acct",
        R2_ACCESS_KEY_ID: "id",
        R2_SECRET_ACCESS_KEY: "secret",
      }),
      null,
    );
  });

  it("builds the default endpoint from the account id", () => {
    const config = r2ConfigFromEnv({
      R2_ACCOUNT_ID: "acct",
      R2_ACCESS_KEY_ID: "id",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET_NAME: "dpd-private-prod",
    });
    assert.deepEqual(config, {
      accessKeyId: "id",
      secretAccessKey: "secret",
      bucketName: "dpd-private-prod",
      endpoint: "https://acct.r2.cloudflarestorage.com",
    });
  });
});
