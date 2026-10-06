import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canResendEsign, esignResendHref } from "./esign-resend";

describe("esign correct and resend", () => {
  it("only offers resend on a declined row", () => {
    assert.equal(canResendEsign("declined"), true);
    assert.equal(canResendEsign("pending"), false);
    assert.equal(canResendEsign("signed"), false);
  });

  it("builds a send URL that keeps the original id", () => {
    const href = esignResendHref({
      requestId: "req-1",
      driverId: "drv-1",
      templateId: "tpl-1",
    });
    assert.ok(href.includes("resentFrom=req-1"));
    assert.ok(href.includes("driver=drv-1"));
    assert.ok(href.includes("template=tpl-1"));
  });
});
