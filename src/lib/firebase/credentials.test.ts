import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFirebaseServiceAccountJson } from "./credentials";

describe("parseFirebaseServiceAccountJson", () => {
  it("reads a normal service-account object", () => {
    const parsed = parseFirebaseServiceAccountJson(
      JSON.stringify({
        project_id: "musallam-delivery-prod",
        client_email: "sa@musallam-delivery-prod.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n",
      }),
    );
    assert.equal(parsed?.projectId, "musallam-delivery-prod");
    assert.match(parsed?.privateKey ?? "", /BEGIN PRIVATE KEY/);
    assert.equal(parsed?.privateKey.includes("\\n"), false);
  });

  it("recovers JSON that was stored with extra backslash-escaping", () => {
    const stored =
      '{\\"project_id\\":\\"musallam-delivery-prod\\",\\"client_email\\":\\"sa@musallam-delivery-prod.iam.gserviceaccount.com\\",\\"private_key\\":\\"-----BEGIN PRIVATE KEY-----\\\\nABC\\\\n-----END PRIVATE KEY-----\\\\n\\"}';
    const parsed = parseFirebaseServiceAccountJson(stored);
    assert.equal(parsed?.projectId, "musallam-delivery-prod");
    assert.equal(parsed?.privateKey.includes("BEGIN PRIVATE KEY"), true);
    assert.equal(parsed?.privateKey.includes("\\n"), false);
  });
});
