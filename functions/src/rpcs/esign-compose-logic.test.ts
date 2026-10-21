import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  assignStaffStampSlots,
  fitCaption,
  resolveStaffStampSlots,
  signedDocumentSourceHash,
  CAPTION_SIZE,
} from "./esign-compose-logic";

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

  it("fills the HR box from the kind when the measured sheet never had one", () => {
    // The loan sheet used to print only the employee line, so a persisted array
    // with no `hr` row silently dropped the HR signature entirely.
    const resolved = resolveStaffStampSlots({
      kind: "loan",
      persistedSlots: [
        { id: "employee", role: "employee", page: 1, xPt: 252, yPt: 407, wPt: 124, hPt: 15 },
      ],
      signers: [{ id: "hr-user", sortOrder: 0 }],
    });
    assert.equal(resolved.assignments.length, 1);
    assert.equal(resolved.assignments[0]?.slot.role, "hr");
    assert.equal(resolved.assignments[0]?.slot.yPt, 188.9);
    // No staff role came from the measured array, so the whole staff layout is
    // the kind's — the truth for a loan sheet that never printed an HR line.
    assert.equal(resolved.slotsSource, "kind_fallback");
  });

  it("merges a persisted staff box with a kind box for the missing role", () => {
    const resolved = resolveStaffStampSlots({
      kind: "penalty",
      persistedSlots: [
        { id: "hr", role: "hr", page: 1, xPt: 40, yPt: 300, wPt: 100, hPt: 22 },
      ],
      signers: [
        { id: "a", sortOrder: 0 },
        { id: "b", sortOrder: 1 },
      ],
    });
    assert.equal(resolved.slotsSource, "mixed");
    assert.equal(resolved.assignments[0]?.slot.xPt, 40);
    assert.equal(resolved.assignments[1]?.slot.role, "gm");
    assert.equal(resolved.assignments[1]?.slot.xPt, 379);
  });

  it("reports kind_fallback when no measured box is usable", () => {
    const resolved = resolveStaffStampSlots({
      kind: "penalty",
      persistedSlots: [],
      signers: [{ id: "a", sortOrder: 0 }],
    });
    assert.equal(resolved.slotsSource, "kind_fallback");
    assert.equal(resolved.assignments[0]?.slot.role, "hr");
  });

  it("reports persisted when every role came from the measured sheet", () => {
    const resolved = resolveStaffStampSlots({
      kind: "penalty",
      persistedSlots: [
        { id: "hr", role: "hr", page: 1, xPt: 172, yPt: 69, wPt: 119, hPt: 23 },
        { id: "gm", role: "gm", page: 1, xPt: 379, yPt: 69, wPt: 119, hPt: 23 },
      ],
      signers: [{ id: "a", sortOrder: 0 }],
    });
    assert.equal(resolved.slotsSource, "persisted");
  });

  it("replaces an unusable measured box instead of dropping the signer", () => {
    const assigned = assignStaffStampSlots({
      kind: "payslip",
      persistedSlots: [
        { id: "employee", role: "employee", page: 1, xPt: 167, yPt: 69, wPt: 119, hPt: 23 },
        // 6pt tall: cannot hold ink, so it must not be used.
        { id: "hr", role: "hr", page: 1, xPt: 435, yPt: 69, wPt: 119, hPt: 6 },
      ],
      signers: [{ id: "a", sortOrder: 0 }],
    });
    assert.equal(assigned.length, 1);
    assert.equal(assigned[0]?.slot.hPt, 23);
    assert.equal(assigned[0]?.slot.yPt, 69);
  });

  it("gives a two-signer penalty its own box each", () => {
    const resolved = resolveStaffStampSlots({
      kind: "penalty",
      persistedSlots: [
        { id: "employee", role: "employee", page: 1, xPt: 446, yPt: 191, wPt: 119, hPt: 23 },
      ],
      signers: [
        { id: "hr-user", sortOrder: 1 },
        { id: "gm-user", sortOrder: 2 },
      ],
    });
    assert.deepEqual(
      resolved.assignments.map((row) => [row.id, row.slot.role]),
      [
        ["hr-user", "hr"],
        ["gm-user", "gm"],
      ],
    );
  });
});

describe("fitCaption", () => {
  it("keeps a name that fits and trims one that does not", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    assert.equal(fitCaption("A. Rider", font, 200), "A. Rider");

    const long = "Abdullah Mohammed Al-Mutairi Al-Sabah";
    const trimmed = fitCaption(long, font, 60);
    assert.ok(trimmed.endsWith("..."), `expected an ellipsis, got ${trimmed}`);
    assert.ok(
      font.widthOfTextAtSize(trimmed, CAPTION_SIZE) <= 60,
      "the trimmed caption must fit the box",
    );
    assert.ok(trimmed.length > 3, "a 60pt box still holds more than the ellipsis");
  });

  it("returns nothing for a box with no width", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    assert.equal(fitCaption("A. Rider", font, 0), "");
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

  it("changes when a resolved staff slot moves", () => {
    const base = {
      documentKey: "admin/doc.pdf",
      employeeSignatureKey: "sig/employee.png",
      employeeSignedAt: "2026-10-19 10:00 UTC",
      signatureSlots: [],
      sheetRenderVersion: 7,
      staff: [{ id: "s1", signatureKey: "sig/hr.png", signedAt: "2026-10-19 11:00 UTC" }],
    };
    const atHr = signedDocumentSourceHash({
      ...base,
      staffSlots: [{ role: "hr", xPt: 172, yPt: 69, wPt: 119, hPt: 23 }],
    });
    const atGm = signedDocumentSourceHash({
      ...base,
      staffSlots: [{ role: "gm", xPt: 379, yPt: 69, wPt: 119, hPt: 23 }],
    });
    assert.notEqual(atHr, atGm);
  });
});
