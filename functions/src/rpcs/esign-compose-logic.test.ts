import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assignStaffStampSlots, signedDocumentSourceHash } from "./esign-compose-logic";

describe("assignStaffStampSlots", () => {
  it("maps penalty signers to hr then gm in sort_order", () => {
    const assigned = assignStaffStampSlots({
      kind: "penalty",
      signers: [
        { id: "b", sortOrder: 2 },
        { id: "a", sortOrder: 1 },
      ],
    });
    assert.deepEqual(
      assigned.map((row) => [row.id, row.slot.role]),
      [
        ["a", "hr"],
        ["b", "gm"],
      ],
    );
  });

  it("maps the first loan signer to the single HR box", () => {
    const assigned = assignStaffStampSlots({
      kind: "loan",
      signers: [
        { id: "one", sortOrder: 0 },
        { id: "two", sortOrder: 1 },
        { id: "three", sortOrder: 2 },
      ],
    });
    assert.deepEqual(assigned.map((row) => row.slot.role), ["hr"]);
    assert.equal(assigned.length, 1);
    assert.equal(assigned.some((row) => row.slot.role.startsWith("ack_")), false);
  });

  it("skips signers past the printed boxes instead of stacking them", () => {
    const assigned = assignStaffStampSlots({
      kind: "payslip",
      signers: [
        { id: "a", sortOrder: 0 },
        { id: "b", sortOrder: 1 },
      ],
    });
    assert.equal(assigned.length, 1);
    assert.equal(assigned[0]?.slot.role, "hr");
  });

  it("prefers a persisted slot when one is usable", () => {
    const assigned = assignStaffStampSlots({
      kind: "general",
      persistedSlots: [
        { id: "employee", role: "employee", page: 1, xPt: 400, yPt: 90, wPt: 100, hPt: 20 },
        { id: "hr", role: "hr", page: 1, xPt: 60, yPt: 200, wPt: 110, hPt: 22 },
      ],
      signers: [{ id: "a", sortOrder: 0 }],
    });
    assert.equal(assigned[0]?.slot.xPt, 60);
    assert.equal(assigned[0]?.slot.yPt, 200);
  });
});

describe("signedDocumentSourceHash", () => {
  it("changes when a staff signature is added", () => {
    const base = {
      documentKey: "admin/doc.pdf",
      employeeSignatureKey: "sig/employee.png",
      employeeSignedAt: "2026-10-19 10:00 UTC",
      stampLayout: { pieces: [] },
      signatureSlots: [],
      sheetRenderVersion: 4,
    };
    const before = signedDocumentSourceHash({ ...base, staff: [] });
    const after = signedDocumentSourceHash({
      ...base,
      staff: [{ id: "s1", signatureKey: "sig/hr.png", signedAt: "2026-10-19 11:00 UTC" }],
    });
    assert.notEqual(before, after);
    assert.equal(
      before,
      signedDocumentSourceHash({ ...base, staff: [] }),
      "the same source must hash the same",
    );
  });
});
