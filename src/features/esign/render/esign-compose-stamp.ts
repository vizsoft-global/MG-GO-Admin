import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

export const COMPOSE_MARGIN = 36;
export const SIG_MAX_WIDTH = 180;
export const SIG_MAX_HEIGHT = 60;
export const CAPTION_SIZE = 7.5;
export const CAPTION_LEADING = 9.5;

/** Matches esign-compose-signed-document — stamp on last page, no new page. */
export type StampInput = {
  pdfBytes: Uint8Array;
  signaturePng: Uint8Array;
  captions: string[];
  dropUnencodableCaptions?: boolean;
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
}> {
  const pdf = await PDFDocument.load(input.pdfBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const signature = await pdf.embedPng(input.signaturePng);
  const pages = pdf.getPages();
  const pageCount = pages.length;
  if (pageCount === 0) {
    throw new Error("empty_document");
  }
  const page = pages[pageCount - 1];
  const { width: pageWidth } = page.getSize();

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

  drawStamp(page, signature, captions, font, pageWidth);
  return { pdfBytes: await pdf.save(), pageCount, droppedCaptions };
}

function drawStamp(
  page: PDFPage,
  signature: PDFImage,
  captions: string[],
  font: PDFFont,
  pageWidth: number,
) {
  const scale = Math.min(
    SIG_MAX_WIDTH / signature.width,
    SIG_MAX_HEIGHT / signature.height,
    1,
  );
  const sigWidth = signature.width * scale;
  const sigHeight = signature.height * scale;
  const captionBlockHeight = captions.length * CAPTION_LEADING;
  const sigX = Math.max(COMPOSE_MARGIN, pageWidth - COMPOSE_MARGIN - sigWidth);
  const sigY = COMPOSE_MARGIN + captionBlockHeight;

  page.drawImage(signature, {
    x: sigX,
    y: sigY,
    width: sigWidth,
    height: sigHeight,
  });

  captions.forEach((line, index) => {
    const textWidth = font.widthOfTextAtSize(line, CAPTION_SIZE);
    page.drawText(line, {
      x: Math.max(COMPOSE_MARGIN, pageWidth - COMPOSE_MARGIN - textWidth),
      y: COMPOSE_MARGIN + captionBlockHeight - (index + 1) * CAPTION_LEADING,
      size: CAPTION_SIZE,
      font,
      color: rgb(0.25, 0.28, 0.32),
    });
  });
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
