import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import {
  composeSignedPdf,
  normalizeEsignObjectKey,
  validateJpeg,
  validatePng,
} from "../../../../functions/src/rpcs/esign-compose-logic";
import { normalizeEsignStorageKey } from "../esign-storage-key";
import { stampSignatureOnLastPage, tinyPng } from "./esign-compose-stamp";

function overrunPng(): Uint8Array {
  const bytes = new Uint8Array(48);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, 1);
  view.setUint32(20, 1);
  bytes[24] = 8;
  bytes[25] = 6;
  view.setUint32(33, 0x00ff_ffff);
  return bytes;
}

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
      kind: "penalty",
    });
    assert.equal(out.pageCount, 1);
    assert.equal(out.droppedCaptions.length, 0);
    assert.ok(out.stamp.y > 150);
    assert.ok(out.stamp.x > 400);
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

describe("esign compose image gate", () => {
  it("rejects a truncated PNG before embedPng", () => {
    assert.equal(validatePng(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])), "truncated");
  });

  it("rejects a PNG whose next chunk overruns the file", () => {
    assert.equal(validatePng(overrunPng()), "chunk_overruns_file");
  });

  it("accepts the 1x1 stamp PNG", () => {
    assert.equal(validatePng(tinyPng()), null);
  });

  it("rejects a JPEG with no end marker and accepts a minimal one", () => {
    assert.equal(validateJpeg(Uint8Array.from([0xff, 0xd8, 0xff, 0x00])), "missing_end_of_image");
    assert.equal(validateJpeg(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])), null);
  });

  it("strips the esign-documents prefix the same way the panel does", () => {
    const key = "esign-documents/admin/abc.pdf";
    assert.equal(normalizeEsignObjectKey(key), normalizeEsignStorageKey(key));
    assert.equal(normalizeEsignObjectKey(key), "admin/abc.pdf");
  });

  it("draws a dragged name and date, and skips Arabic text", async () => {
    const src = await blankPdf();
    const out = await composeSignedPdf({
      sourceBytes: src,
      sourceKind: "pdf",
      signatureBytes: tinyPng(),
      signatureKind: "png",
      captions: [],
      placement: {
        signature: {
          id: "employee",
          role: "employee",
          page: 1,
          xPt: 80,
          yPt: 700,
          wPt: 119,
          hPt: 23,
        },
        texts: [
          { xPt: 80, yPt: 680, wPt: 160, hPt: 11, text: "Sam Test" },
          { xPt: 80, yPt: 664, wPt: 180, hPt: 11, text: "2026-10-16 07:15 UTC" },
          { xPt: 80, yPt: 648, wPt: 160, hPt: 11, text: "أحمد" },
        ],
      },
    });
    const loaded = await PDFDocument.load(out.pdfBytes);
    const page = loaded.getPages()[0];
    assert.ok(page);
    const contents = page.node.Contents();
    assert.ok(contents);
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
    const text = refs
      .map((item) => loaded.context.lookup(item))
      .filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream)
      .map((stream) => Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1"))
      .join("\n");
    const visible = text.replace(/<([0-9A-Fa-f]+)>/g, (_match, hex: string) => {
      let decoded = "";
      for (let i = 0; i < hex.length; i += 2) {
        decoded += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
      }
      return decoded;
    });
    assert.match(visible, /Sam Test/);
    assert.match(visible, /2026-10-16 07:15 UTC/);
    assert.equal(visible.includes("أحمد"), false);
  });

  it("stamps a one-page PDF without adding a page", async () => {
    const src = await blankPdf();
    const out = await composeSignedPdf({
      sourceBytes: src,
      sourceKind: "pdf",
      signatureBytes: tinyPng(),
      signatureKind: "png",
      captions: ["Signed by driver", "أحمد علي", "SIG-1401"],
    });
    assert.equal(out.pageCount, 1);
    const loaded = await PDFDocument.load(out.pdfBytes);
    assert.equal(loaded.getPageCount(), 1);
  });
});
