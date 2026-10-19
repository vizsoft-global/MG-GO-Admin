import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import {
  fitImageInSlot,
  INVALID_SIGNATURE_SLOT,
  isUsableSlot,
  normalizeDocumentKind,
  parseSignatureSlots,
  resolveEmployeeStampSlot,
  slotsForKind,
  type SignSlot,
  type SignSlotRole,
} from "./esign-signature-slots";

/**
 * Signed-copy layout. Employee PNG goes in the named SignSlot (D1/D2), never
 * last-page bottom-right. Slot math is duplicated in esign-signature-slots.ts
 * because functions/src cannot import src/features.
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

function resolveStampSlot(input: {
  slot?: SignSlot;
  kind?: unknown;
  persistedSlots?: unknown;
}): SignSlot {
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

/**
 * A saved layout must always carry the signature box and the signer's name.
 * Everything else — date, request code, employee id, company, position, civil
 * id, zone — is opt-in, so a default stamp cannot spread a caption stack over
 * the pre-printed lines underneath the signature.
 */
export const STAMP_CORE_IDS = ["signature", "name"] as const;
export const STAMP_EXTRA_IDS = [
  "date",
  "code",
  "employee_id",
  "company",
  "position",
  "civil_id",
  "zone",
] as const;
export const STAMP_PIECE_IDS = [...STAMP_CORE_IDS, ...STAMP_EXTRA_IDS] as const;
export type StampPieceId = (typeof STAMP_PIECE_IDS)[number];

/** What a fresh layout draws before an operator opts into the extra boxes. */
export const STAMP_DEFAULT_IDS = ["signature", "name"] as const;

export type StampTextLabels = {
  name: string;
  date: string;
  code: string;
  employeeId?: string;
  company?: string;
  position?: string;
  civilId?: string;
  zone?: string;
};

export type StampPiece = {
  id: StampPieceId;
  page: number;
  xPt: number;
  yPt: number;
  wPt: number;
  hPt: number;
};

export type StampLayout = { pieces: StampPiece[]; removed?: StampPieceId[] };

export type StampTextPlacement = {
  xPt: number;
  yPt: number;
  wPt: number;
  hPt: number;
  text: string;
};

export type StampPlacement = {
  signature: SignSlot;
  texts: StampTextPlacement[];
};

/** One embedded signature image: the rider, or a member of staff countersigning. */
export type ComposeStamp = {
  bytes: Uint8Array;
  kind: "png" | "jpeg";
  slot: SignSlot;
  captions: string[];
  placement?: StampPlacement | null;
  /** Staff stamps keep one caption line inside the slot (name under ink). */
  reserveCaption?: boolean;
};

/**
 * The staff signature boxes a document kind actually prints, in signing order.
 * `ack_received` / `ack_not_received` are acknowledgement boxes, not staff
 * signatures, so they are never in this list.
 */
export const STAFF_STAMP_SLOT_ROLES: Record<
  ReturnType<typeof normalizeDocumentKind>,
  readonly SignSlotRole[]
> = {
  penalty: ["hr", "gm"],
  loan: ["hr", "ceo"],
  payslip: ["hr"],
  general: ["hr"],
};

export type StaffStampSigner = { id: string; sortOrder: number };

/**
 * Deterministic staff → slot mapping: ascending `sort_order`, then id, into the
 * kind's printed boxes. A signer past the last box is skipped (the caller logs
 * it) rather than stamped over the rider or the management caption.
 */
export function assignStaffStampSlots<T extends StaffStampSigner>(input: {
  kind?: unknown;
  persistedSlots?: unknown;
  signers: readonly T[];
}): Array<T & { slot: SignSlot }> {
  const kind = normalizeDocumentKind(input.kind);
  const persisted = parseSignatureSlots(input.persistedSlots) ?? slotsForKind(kind);
  const roles = STAFF_STAMP_SLOT_ROLES[kind];
  const ordered = [...input.signers].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
  );
  const out: Array<T & { slot: SignSlot }> = [];
  for (const signer of ordered) {
    if (out.length >= roles.length) break;
    const role = roles[out.length];
    const slot =
      persisted.find((row) => row.role === role && isUsableSlot(row)) ??
      slotsForKind(kind).find((row) => row.role === role && isUsableSlot(row));
    if (!slot) continue;
    out.push({ ...signer, slot });
  }
  return out;
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Saved drag positions. Null when the row has never been placed by hand. */
export function parseStampLayout(raw: unknown): StampLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const piecesRaw = (raw as { pieces?: unknown }).pieces;
  if (
    !Array.isArray(piecesRaw) ||
    piecesRaw.length < STAMP_CORE_IDS.length ||
    piecesRaw.length > STAMP_PIECE_IDS.length
  ) {
    return null;
  }
  const pieces: StampPiece[] = [];
  const seen = new Set<string>();
  for (const item of piecesRaw) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? "");
    if (!(STAMP_PIECE_IDS as readonly string[]).includes(id) || seen.has(id)) return null;
    seen.add(id);
    const xPt = finiteNumber(row.xPt ?? row.x_pt);
    const yPt = finiteNumber(row.yPt ?? row.y_pt);
    const wPt = finiteNumber(row.wPt ?? row.w_pt);
    const hPt = finiteNumber(row.hPt ?? row.h_pt);
    const page = finiteNumber(row.page) ?? 1;
    if (xPt == null || yPt == null || wPt == null || hPt == null) return null;
    if (wPt < 8 || hPt < 8 || xPt < 0 || yPt < 0 || page < 1) return null;
    pieces.push({ id: id as StampPieceId, page, xPt, yPt, wPt, hPt });
  }
  for (const id of STAMP_CORE_IDS) {
    if (!seen.has(id)) return null;
  }
  const removed = parseRemovedPieces(raw);
  return removed.length > 0 ? { pieces, removed } : { pieces };
}

/** Extras can be deleted by hand, so the panel records which ones an operator took away. */
export function isExtraStampPiece(id: StampPieceId): boolean {
  return (STAMP_EXTRA_IDS as readonly string[]).includes(id);
}

export function parseRemovedPieces(raw: unknown): StampPieceId[] {
  if (!raw || typeof raw !== "object") return [];
  const listRaw = (raw as { removed?: unknown }).removed;
  if (!Array.isArray(listRaw)) return [];
  const removed: StampPieceId[] = [];
  for (const item of listRaw) {
    const id = String(item ?? "") as StampPieceId;
    if (isExtraStampPiece(id) && !removed.includes(id)) removed.push(id);
  }
  return removed;
}

function labelForPiece(id: StampPieceId, labels: StampTextLabels): string {
  switch (id) {
    case "signature":
      return "";
    case "name":
      return labels.name;
    case "date":
      return labels.date;
    case "code":
      return labels.code;
    case "employee_id":
      return labels.employeeId ?? "";
    case "company":
      return labels.company ?? "";
    case "position":
      return labels.position ?? "";
    case "civil_id":
      return labels.civilId ?? "";
    case "zone":
      return labels.zone ?? "";
    default: {
      const exhaustive: never = id;
      return exhaustive;
    }
  }
}

export function placementFromLayout(
  layout: StampLayout,
  labels: StampTextLabels,
): StampPlacement | null {
  const signature = layout.pieces.find((piece) => piece.id === "signature");
  if (!signature) return null;
  const slot: SignSlot = {
    id: "employee",
    role: "employee",
    page: signature.page,
    xPt: signature.xPt,
    yPt: signature.yPt,
    wPt: signature.wPt,
    hPt: signature.hPt,
  };
  if (!isUsableSlot(slot)) return null;
  return {
    signature: slot,
    texts: layout.pieces
      .filter((piece) => piece.id !== "signature")
      .map((piece) => ({
        xPt: piece.xPt,
        yPt: piece.yPt,
        wPt: piece.wPt,
        hPt: piece.hPt,
        text: labelForPiece(piece.id, labels),
      })),
  };
}

function clampToPage(
  box: { xPt: number; yPt: number; wPt: number; hPt: number },
  pageWidth: number,
  pageHeight: number,
) {
  const wPt = Math.min(Math.max(box.wPt, 8), pageWidth);
  const hPt = Math.min(Math.max(box.hPt, 8), pageHeight);
  return {
    xPt: Math.min(Math.max(0, box.xPt), Math.max(0, pageWidth - wPt)),
    yPt: Math.min(Math.max(0, box.yPt), Math.max(0, pageHeight - hPt)),
    wPt,
    hPt,
  };
}

/** Smallest gap kept between a caption baseline and the bottom of its slot. */
export const CAPTION_BOTTOM_GAP = 1;

function drawStampInSlot(
  page: PDFPage,
  signature: PDFImage,
  captions: string[],
  font: PDFFont,
  slot: SignSlot,
  reserveCaption = false,
) {
  // A staff stamp keeps one caption line (the signer's name) under the ink.
  // The rider's stamp fills the whole line; the sheet already prints their name.
  const reserve =
    reserveCaption && captions.length > 0
      ? Math.min(Math.max(slot.hPt - 10, 0), CAPTION_LEADING + 2)
      : 0;
  const imageBox: SignSlot = {
    ...slot,
    yPt: slot.yPt + reserve,
    hPt: Math.max(8, slot.hPt - reserve),
  };
  const fitted = fitImageInSlot(signature.width, signature.height, imageBox);
  page.drawImage(signature, {
    x: fitted.x,
    y: fitted.y,
    width: fitted.w,
    height: fitted.h,
  });
  const lowestBaseline = slot.yPt + CAPTION_BOTTOM_GAP;
  const highestBaseline =
    reserve > 0 ? slot.yPt + reserve - CAPTION_SIZE : slot.yPt + slot.hPt - CAPTION_SIZE;
  let y =
    reserve > 0
      ? Math.min(highestBaseline, fitted.y - 2)
      : Math.min(highestBaseline, fitted.y - 2 - CAPTION_LEADING);
  for (const line of captions) {
    if (y < lowestBaseline) break;
    const textWidth = font.widthOfTextAtSize(line, CAPTION_SIZE);
    if (textWidth > slot.wPt) {
      y -= CAPTION_LEADING;
      continue;
    }
    page.drawText(line, {
      x: Math.min(Math.max(slot.xPt, fitted.x), slot.xPt + slot.wPt - textWidth),
      y,
      size: CAPTION_SIZE,
      font,
      color: rgb(0.25, 0.28, 0.32),
    });
    y -= CAPTION_LEADING;
  }
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
  /** The rider's signature. Omitted when `stamps` carries every signature. */
  signatureBytes?: Uint8Array;
  signatureKind?: "png" | "jpeg";
  captions: string[];
  slot?: SignSlot;
  kind?: unknown;
  persistedSlots?: unknown;
  placement?: StampPlacement | null;
  /** Rider first, then staff in signer order. Backward compatible when absent. */
  stamps?: ComposeStamp[];
}): Promise<{ pdfBytes: Uint8Array; pageCount: number }> {
  const pdf = await loadDocument(input.sourceBytes, input.sourceKind);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const pageCount = pages.length;
  if (pageCount === 0) {
    throw new Error("empty_document");
  }

  const stamps: ComposeStamp[] = [...(input.stamps ?? [])];
  if (stamps.length === 0) {
    if (!input.signatureBytes || !input.signatureKind) {
      throw new Error(INVALID_SIGNATURE_SLOT);
    }
    const placement = input.placement ?? null;
    stamps.push({
      bytes: input.signatureBytes,
      kind: input.signatureKind,
      slot: placement ? placement.signature : resolveStampSlot(input),
      captions: input.captions,
      placement,
    });
  }

  for (const stamp of stamps) {
    if (stamp.kind !== "png" && stamp.kind !== "jpeg") {
      throw new Error(INVALID_SIGNATURE_SLOT);
    }
    const image =
      stamp.kind === "png" ? await pdf.embedPng(stamp.bytes) : await pdf.embedJpg(stamp.bytes);
    const pageIndex = Math.min(Math.max(stamp.slot.page, 1), pageCount) - 1;
    const page = pages[pageIndex];
    if (stamp.placement) {
      drawPlacement(page, image, font, stamp.placement);
      continue;
    }
    const captions = stamp.captions.filter(
      (line) => line.length > 0 && canEncodeWinAnsi(font, line),
    );
    drawStampInSlot(page, image, captions, font, stamp.slot, stamp.reserveCaption === true);
  }
  return { pdfBytes: await pdf.save(), pageCount };
}

/**
 * Fingerprint of everything that is drawn into the signed copy. Recompose when
 * it changes — a new signature, a moved stamp, a re-rendered sheet — without
 * needing `force`. Pure string math so both the Next server action and the
 * Cloud Function compute the same value.
 */
export function signedDocumentSourceHash(input: {
  documentKey: string;
  employeeSignatureKey: string;
  employeeSignedAt?: string | null;
  stampLayout?: unknown;
  signatureSlots?: unknown;
  sheetRenderVersion?: number | null;
  staff: ReadonlyArray<{ id: string; signatureKey: string; signedAt?: string | null }>;
}): string {
  const staff = [...input.staff]
    .map((row) => [row.id, row.signatureKey, row.signedAt ?? ""].join(":"))
    .sort();
  const payload = JSON.stringify({
    document: input.documentKey,
    employee: [input.employeeSignatureKey, input.employeeSignedAt ?? ""],
    layout: input.stampLayout ?? null,
    slots: input.signatureSlots ?? null,
    version: input.sheetRenderVersion ?? null,
    staff,
  });
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < payload.length; i += 1) {
    const code = payload.charCodeAt(i);
    a ^= code;
    a = Math.imul(a, 0x01000193) >>> 0;
    b = (b + code) >>> 0;
    b = Math.imul(b, 0x85ebca6b) >>> 0;
  }
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

function drawPlacement(
  page: PDFPage,
  signature: PDFImage,
  font: PDFFont,
  placement: StampPlacement,
) {
  const size = page.getSize();
  const clamped = clampToPage(placement.signature, size.width, size.height);
  const slot: SignSlot = { ...placement.signature, ...clamped };
  if (!isUsableSlot(slot)) throw new Error(INVALID_SIGNATURE_SLOT);
  const fitted = fitImageInSlot(signature.width, signature.height, slot);
  page.drawImage(signature, {
    x: fitted.x,
    y: fitted.y,
    width: fitted.w,
    height: fitted.h,
  });
  for (const text of placement.texts) {
    const line = text.text.trim();
    if (!line || !canEncodeWinAnsi(font, line)) continue;
    const box = clampToPage(text, size.width, size.height);
    const fontSize = Math.min(8, Math.max(6, box.hPt - 3));
    page.drawText(line, {
      x: box.xPt,
      y: box.yPt + Math.max(1, (box.hPt - fontSize) / 2),
      size: fontSize,
      font,
      color: rgb(0.12, 0.14, 0.18),
      maxWidth: box.wPt,
    });
  }
}
