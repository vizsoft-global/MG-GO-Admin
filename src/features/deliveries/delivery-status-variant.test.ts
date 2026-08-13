import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveDeliveryStatusVariant } from "./delivery-status-variant";
import { patchDeliveryStatusInPages } from "./patch-delivery-status-pages";

describe("resolveDeliveryStatusVariant", () => {
  it("matches the driver app: Under Review is amber, Cancelled is grey", () => {
    assert.equal(resolveDeliveryStatusVariant("under_review"), "warning");
    assert.equal(resolveDeliveryStatusVariant("cancelled"), "neutral");
  });

  it("keeps verified green and rejected red", () => {
    assert.equal(resolveDeliveryStatusVariant("verified"), "success");
    assert.equal(resolveDeliveryStatusVariant("rejected"), "danger");
  });
});

describe("patchDeliveryStatusInPages", () => {
  it("updates the matching row so the list shows the new status without a full reload", () => {
    const pages = [
      {
        rows: [
          { id: "a", status: "under_review" },
          { id: "b", status: "pending" },
        ],
      },
    ];
    const next = patchDeliveryStatusInPages(pages, "a", "verified");
    assert.equal(next[0]?.rows[0]?.status, "verified");
    assert.equal(next[0]?.rows[1]?.status, "pending");
  });
});
