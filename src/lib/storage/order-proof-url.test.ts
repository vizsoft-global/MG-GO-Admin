import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  contentDispositionAttachment,
  isDeliveryProofObjectKey,
  proofDownloadHref,
} from "./order-proof-url";

const PROOF_KEY =
  "drivers/11111111-1111-1111-1111-111111111111/order_proof/2026-08-13/abc.jpg";

describe("proofDownloadHref", () => {
  it("points R2 proof keys at a same-origin download route, not the viewer URL", () => {
    const href = proofDownloadHref(PROOF_KEY);
    assert.ok(href);
    assert.match(href!, /^\/api\/deliveries\/proof-download\?key=/);
    assert.ok(href!.includes(encodeURIComponent(PROOF_KEY)));
    assert.doesNotMatch(href!, /^https?:\/\//);
  });

  it("returns null when there is no key", () => {
    assert.equal(proofDownloadHref(null), null);
    assert.equal(proofDownloadHref("  "), null);
  });
});

describe("isDeliveryProofObjectKey", () => {
  it("allows order/pickup/cancel proof objects under drivers/", () => {
    assert.equal(isDeliveryProofObjectKey(PROOF_KEY), true);
    assert.equal(
      isDeliveryProofObjectKey(
        "drivers/11111111-1111-1111-1111-111111111111/pickup_proof/2026-08-13/x.png",
      ),
      true,
    );
  });

  it("rejects driver documents and login verification photos", () => {
    assert.equal(
      isDeliveryProofObjectKey(
        "drivers/11111111-1111-1111-1111-111111111111/license.jpg",
      ),
      false,
    );
    assert.equal(
      isDeliveryProofObjectKey(
        "drivers/11111111-1111-1111-1111-111111111111/login_verification/2026-08-13/x.jpg",
      ),
      false,
    );
  });
});

describe("contentDispositionAttachment", () => {
  it("forces a download instead of inline preview", () => {
    const header = contentDispositionAttachment("proof.jpg");
    assert.match(header, /^attachment;/);
    assert.match(header, /filename="proof\.jpg"/);
  });

  it("strips quotes and newlines from the filename", () => {
    assert.equal(
      contentDispositionAttachment('a"b\nc.jpg'),
      'attachment; filename="a_b_c.jpg"',
    );
  });
});
