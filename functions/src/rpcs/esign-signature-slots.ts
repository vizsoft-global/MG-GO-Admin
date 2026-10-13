/**
 * Slot math for Cloud Functions. `functions/src` cannot import `src/features`.
 * Keep this byte-aligned with `src/features/esign/render/esign-document-layout.ts`
 * (A4, role set, D1/D2 tops, resolve + fit).
 */

export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;
export const MISSING_EMPLOYEE_SLOT = "missing_employee_signature_slot";
export const INVALID_SIGNATURE_SLOT = "invalid_signature_slot";

export type SignSlotRole =
  | "employee"
  | "hr"
  | "gm"
  | "ceo"
  | "ack_received"
  | "ack_not_received";

export type SignSlot = {
  id: string;
  role: SignSlotRole;
  page: number;
  xPt: number;
  yPt: number;
  wPt: number;
  hPt: number;
};

export type EsignDocumentKind = "penalty" | "loan" | "payslip" | "general";

const KINDS: readonly EsignDocumentKind[] = ["penalty", "loan", "payslip", "general"];

function fromTop(top: number, height: number): number {
  return A4_HEIGHT_PT - top - height;
}

function slot(
  id: string,
  role: SignSlotRole,
  top: number,
  x: number,
  w: number,
  h: number,
  page = 1,
): SignSlot {
  return { id, role, page, xPt: x, yPt: fromTop(top, h), wPt: w, hPt: h };
}

const FIGMA_PAD_TOP = 20;
const FIGMA_STACK = 2;
const FIGMA_PAD_X = 24;
const FIGMA_CONTENT_W = 547;
const FIGMA_LABEL_COL = 168;
const FIGMA_LABEL_GAP = 8;
const FIGMA_LINE_W = 180;
const FIGMA_LINE_H = 16;
const FIGMA_ROW_H = 26;

type FigmaGeom =
  | { h: number }
  | { h: number; line: "employee" }
  | { h: number; boxes: Array<{ role: SignSlotRole; w: number; boxH: number }> }
  | { h: number; decision: "hr" | "ceo"; boxW: number; boxH: number; dy: number }
  | { h: number; ack: "ack_received" | "ack_not_received"; boxW: number; boxH: number; dy: number };

const LINE_X = FIGMA_PAD_X + FIGMA_LABEL_COL + FIGMA_LABEL_GAP;
const LINE_DY = (FIGMA_ROW_H - FIGMA_LINE_H) / 2;

/** Keep identical to PENALTY_GEOM / LOAN_GEOM in esign-document-layout.ts. */
const PENALTY_GEOM: FigmaGeom[] = [
  { h: 18 },
  { h: 1 },
  { h: 20 },
  { h: 26 },
  { h: 26 },
  { h: 26 },
  { h: 26 },
  { h: 26 },
  { h: 20 },
  { h: 26 },
  { h: 26 },
  { h: 20 },
  { h: 18 },
  { h: 18 },
  { h: 18 },
  { h: 18 },
  { h: 18 },
  { h: 18 },
  { h: 18 },
  { h: 18 },
  { h: 18 },
  { h: 18 },
  { h: 18 },
  { h: 26 },
  { h: 26, line: "employee" },
  { h: 20 },
  { h: 36, boxes: [{ role: "hr", w: 140, boxH: 36 }, { role: "gm", w: 140, boxH: 36 }] },
  { h: 14 },
  { h: 16 },
  { h: 26 },
  { h: 22 },
];

const LOAN_GEOM: FigmaGeom[] = [
  { h: 18 },
  { h: 1 },
  { h: 20 },
  { h: 26 },
  { h: 26 },
  { h: 26 },
  { h: 26 },
  { h: 26 },
  { h: 26 },
  { h: 20 },
  { h: 26 },
  { h: 26 },
  { h: 26 },
  { h: 26 },
  { h: 26 },
  { h: 26 },
  { h: 26, line: "employee" },
  { h: 20 },
  { h: 48, decision: "hr", boxW: 120, boxH: 32, dy: 4 },
  { h: 48, decision: "ceo", boxW: 120, boxH: 32, dy: 4 },
  { h: 26 },
  { h: 26 },
  { h: 64, ack: "ack_received", boxW: 130, boxH: 30, dy: 16 },
  { h: 64, ack: "ack_not_received", boxW: 130, boxH: 30, dy: 16 },
];

function slotsFromGeom(steps: FigmaGeom[]): SignSlot[] {
  let y = FIGMA_PAD_TOP;
  const out: SignSlot[] = [];
  for (const step of steps) {
    if ("line" in step) {
      out.push(slot(step.line, step.line, y + LINE_DY, LINE_X, FIGMA_LINE_W, FIGMA_LINE_H));
    } else if ("boxes" in step) {
      let x = FIGMA_PAD_X;
      for (const box of step.boxes) {
        out.push(slot(box.role, box.role, y, x, box.w, box.boxH));
        x += box.w + 12;
      }
    } else if ("decision" in step) {
      const x = FIGMA_PAD_X + FIGMA_CONTENT_W - step.boxW;
      out.push(slot(step.decision, step.decision, y + step.dy, x, step.boxW, step.boxH));
    } else if ("ack" in step) {
      out.push(slot(step.ack, step.ack, y + step.dy, FIGMA_PAD_X, step.boxW, step.boxH));
    }
    y += step.h + FIGMA_STACK;
  }
  return out;
}

export const PENALTY_SLOTS: SignSlot[] = slotsFromGeom(PENALTY_GEOM);

export const LOAN_SLOTS: SignSlot[] = slotsFromGeom(LOAN_GEOM);

export const PAYSLIP_SLOTS: SignSlot[] = [
  slot("employee", "employee", 620, 48, 499, 22),
  slot("hr", "hr", 670, 48, 140, 36),
];

export const GENERAL_SLOTS: SignSlot[] = [
  slot("employee", "employee", 620, 48, 499, 22),
  slot("hr", "hr", 670, 48, 140, 36),
];

export function normalizeDocumentKind(value: unknown): EsignDocumentKind {
  const kind = String(value ?? "");
  return KINDS.includes(kind as EsignDocumentKind) ? (kind as EsignDocumentKind) : "general";
}

export function slotsForKind(kind: EsignDocumentKind): SignSlot[] {
  switch (kind) {
    case "penalty":
      return PENALTY_SLOTS;
    case "loan":
      return LOAN_SLOTS;
    case "payslip":
      return PAYSLIP_SLOTS;
    case "general":
      return GENERAL_SLOTS;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function isUsableSlot(value: SignSlot): boolean {
  if (value.page < 1 || value.wPt < 8 || value.hPt < 8) return false;
  if (value.xPt < 0 || value.yPt < 0) return false;
  if (value.xPt + value.wPt > A4_WIDTH_PT + 2) return false;
  if (value.yPt + value.hPt > A4_HEIGHT_PT + 2) return false;
  return true;
}

export function parseSignatureSlots(raw: unknown): SignSlot[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const slots: SignSlot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    const role = String(row.role ?? "");
    const roles: SignSlotRole[] = [
      "employee",
      "hr",
      "gm",
      "ceo",
      "ack_received",
      "ack_not_received",
    ];
    if (!roles.includes(role as SignSlotRole)) return null;
    const slotRow: SignSlot = {
      id: String(row.id ?? role),
      role: role as SignSlotRole,
      page: Number(row.page ?? 1),
      xPt: Number(row.xPt ?? row.x_pt),
      yPt: Number(row.yPt ?? row.y_pt),
      wPt: Number(row.wPt ?? row.w_pt),
      hPt: Number(row.hPt ?? row.h_pt),
    };
    if (!Number.isFinite(slotRow.xPt) || !Number.isFinite(slotRow.yPt)) return null;
    if (!Number.isFinite(slotRow.wPt) || !Number.isFinite(slotRow.hPt)) return null;
    slots.push(slotRow);
  }
  return slots;
}

export function resolveEmployeeStampSlot(input: {
  persisted?: unknown;
  kind?: unknown;
}): SignSlot {
  const persisted = parseSignatureSlots(input.persisted);
  const fromPersisted = persisted?.find((row) => row.role === "employee" && isUsableSlot(row));
  if (fromPersisted) return fromPersisted;
  const fromKind = slotsForKind(normalizeDocumentKind(input.kind)).find(
    (row) => row.role === "employee" && isUsableSlot(row),
  );
  if (fromKind) return fromKind;
  throw new Error(MISSING_EMPLOYEE_SLOT);
}

export function fitImageInSlot(
  imageWidth: number,
  imageHeight: number,
  box: SignSlot,
): { x: number; y: number; w: number; h: number } {
  if (imageWidth <= 0 || imageHeight <= 0) {
    throw new Error(INVALID_SIGNATURE_SLOT);
  }
  const scale = Math.min(box.wPt / imageWidth, box.hPt / imageHeight, 1);
  const w = imageWidth * scale;
  const h = imageHeight * scale;
  return {
    x: box.xPt + (box.wPt - w) / 2,
    y: box.yPt + (box.hPt - h) / 2,
    w,
    h,
  };
}
