import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseStampLayout as parseInFunctions } from "../../../functions/src/rpcs/esign-compose-logic";
import { slotsForKind } from "./render/esign-document-layout";
import { filledEsignSheetHtml } from "./render/esign-filled-sheet";
import {
  addStampPiece,
  centeredDocumentScroll,
  completeStampLayout,
  cssToPiece,
  defaultStampLayout,
  layoutAroundSignature,
  missingStampPieces,
  parseStampLayout,
  pieceFromPageRect,
  pieceToCss,
  resizeStampPiece,
  restoreStampPieces,
  stampLayoutKey,
} from "./esign-stamp-layout";
import { sanitizeEditedSheetHtml } from "./esign-sheet-edit";

const sample = {
  pieces: [
    { id: "signature", page: 1, xPt: 446, yPt: 191, wPt: 119, hPt: 23 },
    { id: "name", page: 1, xPt: 446, yPt: 179, wPt: 160, hPt: 11 },
    { id: "date", page: 1, xPt: 446, yPt: 167, wPt: 160, hPt: 11 },
    { id: "code", page: 1, xPt: 446, yPt: 155, wPt: 160, hPt: 11 },
  ],
};

describe("stamp layout", () => {
  it("starts a general document on the employee slot", () => {
    const employee = slotsForKind("general").find((slot) => slot.role === "employee");
    const signature = defaultStampLayout("general").pieces.find((piece) => piece.id === "signature");
    assert.ok(employee);
    assert.ok(signature);
    assert.equal(signature.xPt, employee.xPt);
    assert.equal(signature.yPt, employee.yPt);
    assert.equal(signature.wPt, employee.wPt);
    assert.equal(signature.hPt, employee.hPt);
    assert.equal(defaultStampLayout("general").pieces.length, 9);
  });

  it("keeps a saved four-piece layout and fills the extra employee boxes", () => {
    const parsed = parseStampLayout(sample);
    assert.ok(parsed);
    assert.equal(parsed.pieces.length, 4);
    assert.deepEqual(parsed, parseInFunctions(sample));
    const completed = completeStampLayout(parsed);
    assert.equal(completed.pieces.length, 9);
    assert.equal(completed.pieces.find((piece) => piece.id === "signature")?.xPt, 446);
    const withExtra = {
      pieces: [
        ...sample.pieces,
        { id: "employee_id", page: 1, xPt: 446, yPt: 143, wPt: 160, hPt: 11 },
      ],
    };
    assert.equal(parseStampLayout(withExtra)?.pieces.length, 5);
    assert.deepEqual(parseStampLayout(withExtra), parseInFunctions(withExtra));
    const reopened = parseStampLayout(withExtra);
    assert.ok(reopened);
    assert.equal(completeStampLayout(reopened).pieces.length, 9);
  });

  it("keeps a box an operator deleted and restores it only on request", () => {
    const raw = { pieces: sample.pieces, removed: ["zone", "civil_id"] };
    const parsed = parseStampLayout(raw);
    assert.ok(parsed);
    assert.deepEqual(parsed, parseInFunctions(raw));
    const completed = completeStampLayout(parsed);
    assert.equal(completed.pieces.length, 7);
    assert.equal(completed.pieces.some((piece) => piece.id === "zone"), false);
    assert.deepEqual(completeStampLayout(completed).pieces.length, 7);
    const restored = restoreStampPieces(completed);
    assert.equal(restored.pieces.length, 9);
    assert.equal(restored.pieces.filter((piece) => piece.id === "zone").length, 1);
    assert.equal(restored.removed, undefined);
    assert.ok(stampLayoutKey(completed) !== stampLayoutKey(restored));
  });

  it("drops an unknown piece id from the removed list", () => {
    const parsed = parseStampLayout({ pieces: sample.pieces, removed: ["zone", "nope", "zone"] });
    assert.ok(parsed);
    assert.deepEqual(parsed.removed, ["zone"]);
  });

  it("grows the south-east corner without moving the left edge", () => {
    const next = resizeStampPiece(
      { id: "name", page: 1, xPt: 100, yPt: 100, wPt: 40, hPt: 20 },
      "se",
      10,
      5,
    );
    assert.equal(next.xPt, 100);
    assert.equal(next.wPt, 50);
    assert.equal(next.hPt, 25);
    assert.equal(next.yPt, 95);
  });

  it("drops scripts from an edited sheet", () => {
    const clean = sanitizeEditedSheetHtml(
      `<div class="page" data-slot-role="employee"><script>alert(1)</script><span onclick="evil()">Hi</span></div>`,
    );
    assert.ok(clean);
    assert.equal(clean.includes("<script"), false);
    assert.equal(clean.includes("onclick"), false);
    assert.match(clean, /esign-sheet-edited/);
    assert.equal(sanitizeEditedSheetHtml("<p>no sheet</p>"), null);
  });

  it("rejects a layout that is missing a piece", () => {
    assert.equal(parseStampLayout({ pieces: sample.pieces.slice(0, 3) }), null);
    assert.equal(parseInFunctions({ pieces: sample.pieces.slice(0, 3) }), null);
  });

  it("accepts the same JSON in the panel and in functions", () => {
    const panel = parseStampLayout(sample);
    const functions = parseInFunctions(sample);
    assert.deepEqual(panel, functions);
  });

  it("round-trips a box through CSS pixels", () => {
    const piece = sample.pieces[0];
    assert.ok(piece);
    const parsed = parseStampLayout(sample)?.pieces.find((item) => item.id === "signature");
    assert.ok(parsed);
    const scale = 1.5;
    const pageHeight = 841.89;
    const css = pieceToCss(parsed, scale, pageHeight);
    const back = cssToPiece(parsed, css.left + 30, css.top - 12, scale, pageHeight);
    assert.equal(back.xPt, Math.round((parsed.xPt + 30 / scale) * 100) / 100);
    assert.equal(back.yPt, Math.round((parsed.yPt + 12 / scale) * 100) / 100);
  });

  it("turns the employee line into a signature box", () => {
    const piece = pieceFromPageRect(
      { left: 100, bottom: 200, width: 119, height: 23 },
      { left: 0, top: 0, width: 595.28, height: 841.89 },
    );
    assert.equal(piece.xPt, 100);
    assert.equal(piece.yPt, Math.round((841.89 - 200) * 100) / 100);
    assert.equal(piece.wPt, 119);
    assert.equal(piece.hPt, 23);
    const name = layoutAroundSignature(piece).pieces.find((item) => item.id === "name");
    assert.ok(name);
    assert.equal(name.yPt, Math.round((piece.yPt - 12) * 100) / 100);
  });

  it("fills the shared sheet with the stored employee name", () => {
    const html = filledEsignSheetHtml({
      template: {
        document_kind: "general",
        header_en: "General",
        header_ar: "",
        body_en: "Body text",
        body_ar: "",
        declaration_en: "I agree",
        declaration_ar: "",
        fields: [],
      },
      snapshot: {
        company_name: "MG",
        employee_name: "Sam_Test",
        employee_id: "10904",
        driver_code: "10904",
        civil_id: null,
        joined_at: null,
        accommodation: null,
        zone: null,
        project: null,
        nationality: null,
      },
      fieldValues: {},
      description: "",
    });
    assert.match(html, /Sam_Test/);
    assert.match(html, /data-slot-role="employee"/);
    assert.match(html, /Body text/);
  });

  it("keeps the page center under the viewport when zoom doubles", () => {
    const next = centeredDocumentScroll({
      scrollLeft: 0,
      scrollTop: 0,
      viewportWidth: 100,
      viewportHeight: 100,
      pageWidth: 100,
      pageHeight: 100,
      before: 1,
      after: 2,
    });
    assert.equal(next.left, 50);
    assert.equal(next.top, 50);
  });

  it("lists every box that is not on the page, and adds one back", () => {
    const layout = completeStampLayout({
      pieces: sample.pieces,
      removed: ["employee_id", "company"],
    });
    const missing = missingStampPieces(layout);
    assert.equal(missing.includes("employee_id"), true);
    assert.equal(missing.includes("company"), true);
    assert.equal(missing.includes("position"), false);
    assert.equal(missing.includes("signature"), false);

    const added = addStampPiece(layout, "employee_id");
    assert.ok(added.pieces.some((piece) => piece.id === "employee_id"));
    assert.equal((added.removed ?? []).includes("employee_id"), false);
    assert.equal((added.removed ?? []).includes("company"), true);
    assert.equal(missingStampPieces(added).includes("employee_id"), false);
  });

  it("does not stack an added box on top of one already there", () => {
    const layout = completeStampLayout({
      pieces: sample.pieces,
      removed: ["employee_id"],
    });
    const signature = layout.pieces.find((piece) => piece.id === "signature");
    assert.ok(signature);
    const target = layoutAroundSignature(signature).pieces.find(
      (piece) => piece.id === "employee_id",
    );
    assert.ok(target);
    assert.equal(missingStampPieces(layout).includes("employee_id"), true);
    const moved = {
      pieces: layout.pieces.map((piece) =>
        piece.id === "date" ? { ...piece, xPt: target.xPt, yPt: target.yPt } : piece,
      ),
    };
    const added = addStampPiece(moved, "employee_id");
    const placed = added.pieces.find((piece) => piece.id === "employee_id");
    const date = added.pieces.find((piece) => piece.id === "date");
    assert.ok(placed && date);
    assert.notEqual(placed.yPt, target.yPt);
    const overlaps =
      placed.xPt < date.xPt + date.wPt &&
      date.xPt < placed.xPt + placed.wPt &&
      placed.yPt < date.yPt + date.hPt &&
      date.yPt < placed.yPt + placed.hPt;
    assert.equal(overlaps, false);
  });

  it("leaves the layout alone when the box is already on the page", () => {
    const layout = completeStampLayout({ pieces: sample.pieces });
    assert.equal(addStampPiece(layout, "signature"), layout);
  });
});
