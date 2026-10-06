import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { esignRemindBody, esignRemindChannelLive } from "./esign-remind-message";

describe("esign remind message", () => {
  it("falls back to the document title when the custom body is blank", () => {
    assert.equal(esignRemindBody("Please open this", "Loan"), "Please open this");
    assert.equal(esignRemindBody("   ", "Loan"), "Loan");
    assert.equal(esignRemindBody(null, "Loan"), "Loan");
  });

  it("keeps SMS and Email coming soon", () => {
    assert.equal(esignRemindChannelLive("app"), true);
    assert.equal(esignRemindChannelLive("sms"), false);
    assert.equal(esignRemindChannelLive("email"), false);
  });
});
