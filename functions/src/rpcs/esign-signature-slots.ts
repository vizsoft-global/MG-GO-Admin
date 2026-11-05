/**
 * Slot math for Cloud Functions. `functions/src` cannot import `src/features`.
 * Keep this byte-aligned with `src/features/esign/render/esign-document-layout.ts`
 * (A4, role set, D1/D2 tops, resolve + fit).
 */

export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;
export const MISSING_EMPLOYEE_SLOT = "missing_employee_signature_slot";
export const INVALID_SIGNATURE_SLOT = "invalid_signature_slot";

/**
 * Printed-sheet version stamped on newly rendered HTML.
 *
 * Mirrors `src/features/esign/render/esign-document-html.ts`. Slot trust is
 * gated on `ESIGN_SLOT_MEASURE_SINCE`, not this number: bumping the render
 * version must not discard slots measured at 7.
 *
 * 9 — Leave Request (five signed boxes) and the client's employee-block order.
 */
export const ESIGN_SHEET_RENDER_VERSION = 9;

/** Persisted `signature_slots` at this sheet version or later stay usable. */
export const ESIGN_SLOT_MEASURE_SINCE = 7;

/** A staff box shorter than this cannot hold ink and a caption line. */
export const MIN_SLOT_HEIGHT = 8;

export type SignSlotRole =
  | "employee"
  | "hr"
  | "gm"
  | "ceo"
  | "ack_received"
  | "ack_not_received"
  | "direct_manager"
  | "hr_responsibility"
  | "hr_manager"
  | "general_manager";

export type SignSlot = {
  id: string;
  role: SignSlotRole;
  page: number;
  xPt: number;
  yPt: number;
  wPt: number;
  hPt: number;
};

export type EsignDocumentKind = "penalty" | "loan" | "payslip" | "general" | "leave";

const KINDS: readonly EsignDocumentKind[] = ["penalty", "loan", "payslip", "general", "leave"];

/** Ruled lines on the client sheet dock. Keep identical to esign-document-layout.ts. */
export const PENALTY_SLOTS: SignSlot[] = [
  { id: "employee", role: "employee", page: 1, xPt: 446, yPt: 191, wPt: 119, hPt: 23 },
  { id: "hr", role: "hr", page: 1, xPt: 172, yPt: 69, wPt: 119, hPt: 23 },
  { id: "gm", role: "gm", page: 1, xPt: 379, yPt: 69, wPt: 119, hPt: 23 },
];

export const LOAN_SLOTS: SignSlot[] = [
  { id: "employee", role: "employee", page: 1, xPt: 252.29, yPt: 407.8, wPt: 124.9, hPt: 14.73 },
  { id: "hr", role: "hr", page: 1, xPt: 252.29, yPt: 188.9, wPt: 124.9, hPt: 14.73 },
];

export const PAYSLIP_SLOTS: SignSlot[] = [
  { id: "employee", role: "employee", page: 1, xPt: 167, yPt: 69, wPt: 119, hPt: 23 },
  { id: "hr", role: "hr", page: 1, xPt: 435, yPt: 69, wPt: 119, hPt: 23 },
];

export const GENERAL_SLOTS: SignSlot[] = [
  { id: "employee", role: "employee", page: 1, xPt: 446, yPt: 191, wPt: 119, hPt: 23 },
  { id: "hr", role: "hr", page: 1, xPt: 172, yPt: 69, wPt: 119, hPt: 23 },
];

/** Five signed boxes on one row. Keep identical to esign-document-layout.ts. */
export const LEAVE_SLOTS: SignSlot[] = (() => {
  const width = 101;
  const gutter = 10;
  const height = 26;
  const top = 24;
  const roles: SignSlotRole[] = [
    "employee",
    "direct_manager",
    "hr_responsibility",
    "hr_manager",
    "general_manager",
  ];
  return roles.map((role, index) => ({
    id: role,
    role,
    page: 1,
    xPt: 24 + index * (width + gutter),
    yPt: A4_HEIGHT_PT - top - height,
    wPt: width,
    hPt: height,
  }));
})();

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
    case "leave":
      return LEAVE_SLOTS;
    case "general":
      return GENERAL_SLOTS;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function isUsableSlot(value: SignSlot): boolean {
  if (value.page < 1 || value.wPt < MIN_SLOT_HEIGHT || value.hPt < MIN_SLOT_HEIGHT) return false;
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
      "direct_manager",
      "hr_responsibility",
      "hr_manager",
      "general_manager",
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
  sheetRenderVersion?: number | null;
}): SignSlot {
  const version = input.sheetRenderVersion;
  const trustPersisted =
    version === undefined || (version !== null && version >= ESIGN_SLOT_MEASURE_SINCE);
  const persisted = trustPersisted ? parseSignatureSlots(input.persisted) : null;
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
