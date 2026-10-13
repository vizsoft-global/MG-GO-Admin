import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import {
  fitImageInSlot,
  INVALID_SIGNATURE_SLOT,
  isUsableSlot,
  resolveEmployeeStampSlot,
  type SignSlot,
} from "./esign-document-layout";

export const COMPOSE_MARGIN = 36;
export const SIG_MAX_WIDTH = 180;
export const SIG_MAX_HEIGHT = 60;
export const CAPTION_SIZE = 7.5;
export const CAPTION_LEADING = 9.5;

export type StampInput = {
  pdfBytes: Uint8Array;
  signaturePng: Uint8Array;
  captions: string[];
  dropUnencodableCaptions?: boolean;
  slot?: SignSlot;
  kind?: unknown;
  persistedSlots?: unknown;
};

export function canEncodeWinAnsi(font: PDFFont, text: string): boolean {
  try {
    font.encodeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function stampSignatureOnLastPage(input: StampInput): Promise<{
  pdfBytes: Uint8Array;
  pageCount: number;
  droppedCaptions: string[];
  stamp: { x: number; y: number; w: number; h: number; page: number };
}> {
  const pdf = await PDFDocument.load(input.pdfBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const signature = await pdf.embedPng(input.signaturePng);
  const pages = pdf.getPages();
  const pageCount = pages.length;
  if (pageCount === 0) {
    throw new Error("empty_document");
  }

  const slot = resolveStampSlot(input);
  const pageIndex = Math.min(Math.max(slot.page, 1), pageCount) - 1;
  const page = pages[pageIndex];

  const droppedCaptions: string[] = [];
  const captions = input.captions.filter((line) => {
    if (!line) return false;
    if (canEncodeWinAnsi(font, line)) return true;
    if (input.dropUnencodableCaptions) {
      droppedCaptions.push(line);
      return false;
    }
    throw new Error(`winansi_unencodable:${line}`);
  });

  const stamp = drawStampInSlot(page, signature, captions, font, slot);
  return { pdfBytes: await pdf.save(), pageCount, droppedCaptions, stamp };
}

function resolveStampSlot(input: StampInput): SignSlot {
  if (input.slot) {
    if (!isUsableSlot(input.slot) || input.slot.role !== "employee") {
      throw new Error(INVALID_SIGNATURE_SLOT);
    }
    return input.slot;
  }
  return resolveEmployeeStampSlot({
    persisted: input.persistedSlots,
    kind: input.kind,
  });
}

function drawStampInSlot(
  page: PDFPage,
  signature: PDFImage,
  captions: string[],
  font: PDFFont,
  slot: SignSlot,
): { x: number; y: number; w: number; h: number; page: number } {
  const fitted = fitImageInSlot(signature.width, signature.height, slot);
  page.drawImage(signature, {
    x: fitted.x,
    y: fitted.y,
    width: fitted.w,
    height: fitted.h,
  });

  const captionTop = fitted.y - 2;
  captions.forEach((line, index) => {
    const y = captionTop - (index + 1) * CAPTION_LEADING;
    if (y < slot.yPt - 4) return;
    const textWidth = font.widthOfTextAtSize(line, CAPTION_SIZE);
    const x = Math.min(
      Math.max(slot.xPt, fitted.x),
      slot.xPt + slot.wPt - textWidth,
    );
    page.drawText(line, {
      x,
      y,
      size: CAPTION_SIZE,
      font,
      color: rgb(0.25, 0.28, 0.32),
    });
  });

  return { ...fitted, page: slot.page };
}

/** 1x1 opaque PNG — enough for stamp geometry tests. */
export function tinyPng(): Uint8Array {
  return Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
}
