import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

/**
 * Signed-copy layout. Same placement as `stampSignatureOnLastPage` in
 * `src/features/esign/render/esign-compose-stamp.ts` and the old
 * `esign-compose-signed-document` worker: last page, bottom-right, 36pt
 * margin, signature scaled into 180×60pt, Helvetica 7.5pt caption.
 */

export const ESIGN_OBJECT_PREFIX = "esign-documents";
export const COMPOSE_MARGIN = 36;
export const SIG_MAX_WIDTH = 180;
export const SIG_MAX_HEIGHT = 60;
export const CAPTION_SIZE = 7.5;
export const CAPTION_LEADING = 9.5;
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

export const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
export const MAX_SIGNATURE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 30_000_000;

const PNG_COLOUR_TYPES = new Set([0, 2, 3, 4, 6]);
const PNG_BIT_DEPTHS = new Set([1, 2, 4, 8, 16]);

export type SourceKind = "pdf" | "png" | "jpeg" | "unsupported";

export function normalizeEsignObjectKey(key: string): string {
  const trimmed = key.trim().replace(/^\/+/, "");
  const prefix = `${ESIGN_OBJECT_PREFIX}/`;
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
}

export function esignObjectPath(key: string): string {
  return `${ESIGN_OBJECT_PREFIX}/${normalizeEsignObjectKey(key)}`;
}

export function sniff(bytes: Uint8Array): SourceKind {
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return "pdf";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  return "unsupported";
}

/**
 * Walks the PNG chunk table. A file that starts with the signature but carries
 * a bogus IDAT length is what killed the Supabase worker (`WORKER_RESOURCE_LIMIT`)
 * inside `embedPng` before `fail()` could record `malformed_signature_image`.
 */
export function validatePng(bytes: Uint8Array): string | null {
  if (bytes.length < 8 + 25) return "truncated";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (view.getUint32(8) !== 13) return "bad_ihdr_length";
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return "missing_ihdr";

  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) return "zero_dimension";
  if (width * height > MAX_IMAGE_PIXELS) return "too_many_pixels";
  if (!PNG_BIT_DEPTHS.has(bytes[24])) return "bad_bit_depth";
  if (!PNG_COLOUR_TYPES.has(bytes[25])) return "bad_colour_type";

  let offset = 8;
  let sawData = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    if (length > bytes.length - offset - 12) return "chunk_overruns_file";
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "IDAT") sawData = true;
    if (type === "IEND") return sawData ? null : "no_image_data";
    offset += 12 + length;
  }
  return "missing_iend";
}

export function validateJpeg(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return "truncated";
  const tailStart = Math.max(0, bytes.length - 512);
  for (let i = bytes.length - 2; i >= tailStart; i -= 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return null;
  }
  return "missing_end_of_image";
}

export function validateImage(bytes: Uint8Array, kind: SourceKind): string | null {
  switch (kind) {
    case "png":
      return validatePng(bytes);
    case "jpeg":
      return validateJpeg(bytes);
    case "pdf":
    case "unsupported":
      return null;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function canEncodeWinAnsi(font: PDFFont, text: string): boolean {
  try {
    font.encodeText(text);
    return true;
  } catch {
    return false;
  }
}

function drawStamp(
  page: PDFPage,
  signature: PDFImage,
  captions: string[],
  font: PDFFont,
  pageWidth: number,
) {
  const scale = Math.min(SIG_MAX_WIDTH / signature.width, SIG_MAX_HEIGHT / signature.height, 1);
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

async function loadDocument(bytes: Uint8Array, kind: "pdf" | "png" | "jpeg") {
  if (kind === "pdf") return PDFDocument.load(bytes);

  const pdf = await PDFDocument.create();
  const image = kind === "png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  const scale = Math.min(
    (A4_WIDTH - COMPOSE_MARGIN * 2) / image.width,
    (A4_HEIGHT - COMPOSE_MARGIN * 2) / image.height,
    1,
  );
  const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  page.drawImage(image, {
    x: (A4_WIDTH - drawWidth) / 2,
    y: (A4_HEIGHT - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  });
  return pdf;
}

export async function composeSignedPdf(input: {
  sourceBytes: Uint8Array;
  sourceKind: "pdf" | "png" | "jpeg";
  signatureBytes: Uint8Array;
  signatureKind: "png" | "jpeg";
  captions: string[];
}): Promise<{ pdfBytes: Uint8Array; pageCount: number }> {
  const pdf = await loadDocument(input.sourceBytes, input.sourceKind);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const signature =
    input.signatureKind === "png"
      ? await pdf.embedPng(input.signatureBytes)
      : await pdf.embedJpg(input.signatureBytes);
  const pages = pdf.getPages();
  const pageCount = pages.length;
  if (pageCount === 0) {
    throw new Error("empty_document");
  }
  const page = pages[pageCount - 1];
  const { width: pageWidth } = page.getSize();
  const captions = input.captions.filter((line) => line.length > 0 && canEncodeWinAnsi(font, line));
  drawStamp(page, signature, captions, font, pageWidth);
  return { pdfBytes: await pdf.save(), pageCount };
}
