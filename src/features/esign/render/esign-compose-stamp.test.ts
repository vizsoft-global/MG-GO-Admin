import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";
import { stampSignatureOnLastPage, tinyPng } from "./esign-compose-stamp";

async function blankPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage([595.28, 841.89]);
  return pdf.save();
}

describe("stampSignatureOnLastPage", () => {
  it("keeps page count and accepts WinAnsi captions", async () => {
    const src = await blankPdf();
    const out = await stampSignatureOnLastPage({
      pdfBytes: src,
      signaturePng: tinyPng(),
      captions: ["Signed by driver", "2026-09-23", "SIG-1401"],
    });
    assert.equal(out.pageCount, 1);
    assert.equal(out.droppedCaptions.length, 0);
    const loaded = await PDFDocument.load(out.pdfBytes);
    assert.equal(loaded.getPageCount(), 1);
  });

  it("throws on an Arabic signer name with Helvetica", async () => {
    const src = await blankPdf();
    await assert.rejects(
      () =>
        stampSignatureOnLastPage({
          pdfBytes: src,
          signaturePng: tinyPng(),
          captions: ["أحمد علي", "2026-09-23", "SIG-1401"],
        }),
      /winansi_unencodable/,
    );
  });

  it("drops the Arabic caption when the guard is on", async () => {
    const src = await blankPdf();
    const out = await stampSignatureOnLastPage({
      pdfBytes: src,
      signaturePng: tinyPng(),
      captions: ["أحمد علي", "SIG-1401"],
      dropUnencodableCaptions: true,
    });
    assert.deepEqual(out.droppedCaptions, ["أحمد علي"]);
    assert.equal(out.pageCount, 1);
  });
});
