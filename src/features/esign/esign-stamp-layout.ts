import { normalizeDocumentKind } from "./document-kind";
import {
  A4_HEIGHT_PT,
  A4_WIDTH_PT,
  isUsableSlot,
  parseSignatureSlots,
  slotsForKind,
} from "./render/esign-document-layout";

/**
 * The two boxes a fresh layout always draws. Date, request code, employee id,
 * company, position, civil id and zone are opt-in, so the default stamp cannot
 * stack a caption over the pre-printed lines beneath the signature.
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

/** What a default layout draws. `STAMP_PIECE_IDS` is the full opt-in catalogue. */
export const STAMP_DEFAULT_IDS = ["signature", "name"] as const;

export const RESIZE_CORNERS = ["nw", "ne", "sw", "se"] as const;
export type ResizeCorner = (typeof RESIZE_CORNERS)[number];

export type StampPieceLabels = {
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

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Extras can be removed, so only a box that is absent *and* not listed in `removed` is refilled. */
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

/** Drag positions saved on the request. Null until someone places the stamp. */
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

/**
 * Older saves have only the four core boxes. The extra employee boxes appear under them.
 *
 * A box the operator deleted stays deleted, and a whole set of them stays deleted too —
 * otherwise the last delete would restore the legacy shape and everything would come back.
 */
export function completeStampLayout(layout: StampLayout): StampLayout {
  const signature = layout.pieces.find((piece) => piece.id === "signature");
  if (!signature) return layout;
  const defaults = layoutAroundSignature(signature);
  const have = new Set(layout.pieces.map((piece) => piece.id));
  const gone = new Set<StampPieceId>(layout.removed ?? []);
  const missing = defaults.pieces.filter(
    (piece) => !have.has(piece.id) && !gone.has(piece.id),
  );
  if (missing.length === 0) return layout;
  return { ...layout, pieces: [...layout.pieces, ...missing] };
}

/** Every box the sheet does not currently carry, in print order. */
export function missingStampPieces(layout: StampLayout): StampPieceId[] {
  const have = new Set(layout.pieces.map((piece) => piece.id));
  return STAMP_PIECE_IDS.filter((id) => !have.has(id));
}

function boxesOverlap(a: StampPiece, b: StampPiece): boolean {
  if (a.page !== b.page) return false;
  return (
    a.xPt < b.xPt + b.wPt &&
    b.xPt < a.xPt + a.wPt &&
    a.yPt < b.yPt + b.hPt &&
    b.yPt < a.yPt + a.hPt
  );
}

/**
 * Adds one box, even one that was never placed. The default template position is used
 * first; if the operator has dragged something over it, the box slides up the sheet
 * until it is clear rather than landing under another box.
 */
export function addStampPiece(layout: StampLayout, id: StampPieceId): StampLayout {
  if (layout.pieces.some((piece) => piece.id === id)) return layout;
  const signature = layout.pieces.find((piece) => piece.id === "signature");
  const template = signature
    ? layoutAllPieces(signature).pieces.find((piece) => piece.id === id)
    : null;
  if (!template) return layout;
  const placed = freeStampPosition(template, layout.pieces);
  const removed = (layout.removed ?? []).filter((pieceId) => pieceId !== id);
  return removed.length > 0
    ? { pieces: [...layout.pieces, placed], removed }
    : { pieces: [...layout.pieces, placed] };
}

function freeStampPosition(piece: StampPiece, existing: StampPiece[]): StampPiece {
  const step = piece.hPt + 1;
  const attempts = Math.max(1, Math.floor(piece.yPt / step));
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    const candidate = clampPiece({ ...piece, yPt: piece.yPt - attempt * step });
    if (!existing.some((other) => boxesOverlap(candidate, other))) return candidate;
  }
  return clampPiece(piece);
}

/** Puts the boxes an operator deleted back where the extras sit today. */
export function restoreStampPieces(layout: StampLayout): StampLayout {
  const removed = layout.removed ?? [];
  if (removed.length === 0) return layout;
  const signature = layout.pieces.find((piece) => piece.id === "signature");
  const have = new Set(layout.pieces.map((piece) => piece.id));
  const pieces = [...layout.pieces];
  if (signature) {
    const defaults = layoutAllPieces(signature);
    for (const id of STAMP_PIECE_IDS) {
      if (!removed.includes(id) || have.has(id)) continue;
      const template = defaults.pieces.find((piece) => piece.id === id);
      if (template) pieces.push(template);
    }
  }
  return { pieces };
}

/**
 * `dxPt` is rightward. `dyDownPt` is downward on the screen.
 * The south edge moves the PDF bottom; the north edge keeps it.
 */
export function resizeStampPiece(
  piece: StampPiece,
  corner: ResizeCorner,
  dxPt: number,
  dyDownPt: number,
): StampPiece {
  let { xPt, yPt, wPt, hPt } = piece;
  const east = corner === "ne" || corner === "se";
  const west = corner === "nw" || corner === "sw";
  const south = corner === "se" || corner === "sw";
  const north = corner === "ne" || corner === "nw";
  if (east) wPt += dxPt;
  if (west) {
    xPt += dxPt;
    wPt -= dxPt;
  }
  if (south) {
    hPt += dyDownPt;
    yPt -= dyDownPt;
  }
  if (north) hPt -= dyDownPt;
  return clampPiece({ ...piece, xPt, yPt, wPt, hPt });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function clampPiece(
  piece: StampPiece,
  pageWidth = A4_WIDTH_PT,
  pageHeight = A4_HEIGHT_PT,
): StampPiece {
  const wPt = Math.min(Math.max(piece.wPt, 8), pageWidth);
  const hPt = Math.min(Math.max(piece.hPt, 8), pageHeight);
  return {
    ...piece,
    wPt: round2(wPt),
    hPt: round2(hPt),
    xPt: round2(Math.min(Math.max(0, piece.xPt), Math.max(0, pageWidth - wPt))),
    yPt: round2(Math.min(Math.max(0, piece.yPt), Math.max(0, pageHeight - hPt))),
  };
}

/** Same instant the signed PDF prints: `YYYY-MM-DD HH:MM UTC`. */
export function formatStampInstant(value: unknown): string {
  let iso = "";
  if (typeof value === "string") iso = value;
  else if (value instanceof Date) iso = value.toISOString();
  else if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    iso = Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }
  if (iso.length < 16) return "";
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** Name, date, and request code sit just under a signature box, in PDF points. */
export function layoutAroundSignature(signature: StampPiece): StampLayout {
  return layoutWithIds(signature, STAMP_DEFAULT_IDS);
}

/** Every opt-in box, in print order, anchored under the signature. */
export function layoutAllPieces(signature: StampPiece): StampLayout {
  return layoutWithIds(signature, STAMP_PIECE_IDS);
}

function layoutWithIds(
  signature: StampPiece,
  ids: readonly StampPieceId[],
): StampLayout {
  const employee = clampPiece({ ...signature, id: "signature" });
  const textW = 160;
  const textH = 11;
  const gap = 1;
  let y = employee.yPt - gap - textH;
  const pieces: StampPiece[] = [employee];
  for (const id of ids) {
    if (id === "signature") continue;
    if (y < 8) y = 8;
    pieces.push(
      clampPiece({
        id,
        page: employee.page,
        xPt: employee.xPt,
        yPt: y,
        wPt: textW,
        hPt: textH,
      }),
    );
    y -= gap + textH;
  }
  return { pieces };
}

/**
 * CSS pixels of the employee line, measured against `.page`, become the PDF
 * signature box. Ratios stay correct when the sheet is scaled.
 */
export function pieceFromPageRect(
  line: { left: number; bottom: number; width: number; height: number },
  page: { left: number; top: number; width: number; height: number },
): StampPiece {
  const width = page.width || 1;
  const height = page.height || 1;
  return clampPiece({
    id: "signature",
    page: 1,
    xPt: ((line.left - page.left) / width) * A4_WIDTH_PT,
    yPt: A4_HEIGHT_PT - ((line.bottom - page.top) / height) * A4_HEIGHT_PT,
    wPt: (line.width / width) * A4_WIDTH_PT,
    hPt: (line.height / height) * A4_HEIGHT_PT,
  });
}

export function defaultStampLayout(kind: unknown, persistedSlots?: unknown): StampLayout {
  const normalized = normalizeDocumentKind(kind);
  const parsed = parseSignatureSlots(persistedSlots);
  const fallback = slotsForKind(normalized);
  const employee =
    parsed?.find((slot) => slot.role === "employee" && isUsableSlot(slot)) ??
    fallback.find((slot) => slot.role === "employee");
  if (!employee) {
    throw new Error("missing_employee_signature_slot");
  }
  return layoutAroundSignature({
    id: "signature",
    page: employee.page,
    xPt: employee.xPt,
    yPt: employee.yPt,
    wPt: employee.wPt,
    hPt: employee.hPt,
  });
}

export function stampLayoutKey(layout: StampLayout): string {
  const pieces = layout.pieces
    .map((piece) => {
      const clamped = clampPiece(piece);
      return [
        clamped.id,
        clamped.page,
        clamped.xPt.toFixed(2),
        clamped.yPt.toFixed(2),
        clamped.wPt.toFixed(2),
        clamped.hPt.toFixed(2),
      ].join(":");
    })
    .sort()
    .join("|");
  const removed = (layout.removed ?? []).slice().sort();
  return removed.length > 0 ? `${pieces}|removed:${removed.join(",")}` : pieces;
}

/** Keeps the viewport center on the same point of the page when the zoom scale changes. */
export function centeredDocumentScroll(input: {
  scrollLeft: number;
  scrollTop: number;
  viewportWidth: number;
  viewportHeight: number;
  pageWidth: number;
  pageHeight: number;
  before: number;
  after: number;
}): { left: number; top: number } {
  const contentW = input.pageWidth * input.before;
  const contentH = input.pageHeight * input.before;
  const wrapW = Math.max(input.viewportWidth, contentW);
  const wrapH = Math.max(input.viewportHeight, contentH);
  const originX = (wrapW - contentW) / 2;
  const originY = (wrapH - contentH) / 2;
  const docX = input.scrollLeft + input.viewportWidth / 2 - originX;
  const docY = input.scrollTop + input.viewportHeight / 2 - originY;
  const ratio = input.before > 0 ? input.after / input.before : 1;
  const nextW = input.pageWidth * input.after;
  const nextH = input.pageHeight * input.after;
  const nextWrapW = Math.max(input.viewportWidth, nextW);
  const nextWrapH = Math.max(input.viewportHeight, nextH);
  return {
    left: (nextWrapW - nextW) / 2 + docX * ratio - input.viewportWidth / 2,
    top: (nextWrapH - nextH) / 2 + docY * ratio - input.viewportHeight / 2,
  };
}

export function pieceToCss(piece: StampPiece, scale: number, pageHeightPt: number) {
  return {
    left: piece.xPt * scale,
    top: (pageHeightPt - piece.yPt - piece.hPt) * scale,
    width: piece.wPt * scale,
    height: piece.hPt * scale,
  };
}

export function cssToPiece(
  piece: StampPiece,
  left: number,
  top: number,
  scale: number,
  pageHeightPt: number,
): StampPiece {
  return clampPiece({
    ...piece,
    xPt: left / scale,
    yPt: pageHeightPt - piece.hPt - top / scale,
  });
}

export function stampPieceLabelKey(
  id: StampPieceId,
):
  | "pieceSignature"
  | "pieceName"
  | "pieceDate"
  | "pieceCode"
  | "pieceEmployeeId"
  | "pieceCompany"
  | "piecePosition"
  | "pieceCivilId"
  | "pieceZone" {
  switch (id) {
    case "signature":
      return "pieceSignature";
    case "name":
      return "pieceName";
    case "date":
      return "pieceDate";
    case "code":
      return "pieceCode";
    case "employee_id":
      return "pieceEmployeeId";
    case "company":
      return "pieceCompany";
    case "position":
      return "piecePosition";
    case "civil_id":
      return "pieceCivilId";
    case "zone":
      return "pieceZone";
    default: {
      const exhaustive: never = id;
      return exhaustive;
    }
  }
}

export function stampPieceText(id: StampPieceId, labels: StampPieceLabels): string {
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
