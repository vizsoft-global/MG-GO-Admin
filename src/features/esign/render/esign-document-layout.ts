import { normalizeDocumentKind } from "../document-kind";
import {
  ACCIDENT_EMPLOYEE_ROW_KEYS,
  ESIGN_EMPLOYEE_CORE_ROWS,
  ESIGN_EMPLOYEE_ROWS,
  accidentEmployeeRows,
} from "../employee-block";
import {
  ACCIDENT_CONSUMED_KEYS,
  REQUEST_KIND_KEY,
  ACCIDENT_REQUEST_KINDS,
  accidentKindLabel,
  isAccidentRequest,
  normalizeAccidentKind,
  requestedDocumentLines,
  type AccidentRequestKind,
} from "../esign-accident-fields";
import {
  checksFromPenaltyFields,
  parsePenaltyActionTokens,
  PENALTY_CHECKS,
  PENALTY_CHECK_SLOT_COUNT,
  PENALTY_VISIBLE_FIELD_KEY,
} from "../esign-penalty-checks";
import type { EsignDocumentKind } from "../types";
import type { EsignEmployeeSnapshot } from "./esign-placeholders";
import { fillPlaceholders, snapshotValues } from "./esign-placeholders";

export { PENALTY_CHECKS } from "../esign-penalty-checks";

/** A4 portrait in PDF points — Figma D1/D2 frames are 595×842. */
export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;

export const MISSING_EMPLOYEE_SLOT = "missing_employee_signature_slot";
export const INVALID_SIGNATURE_SLOT = "invalid_signature_slot";

/**
 * Persisted `signature_slots` measured at this `sheet_render_version` or later
 * still match the printed boxes. Newer `ESIGN_SHEET_RENDER_VERSION` values must
 * not discard those measurements. `functions/src/rpcs/esign-signature-slots.ts`
 * mirrors this number.
 */
export const ESIGN_SLOT_MEASURE_SINCE = 7;

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
  /** 1-based page index. */
  page: number;
  /** PDF origin: bottom-left. */
  xPt: number;
  yPt: number;
  wPt: number;
  hPt: number;
};

export type BilingualText = { en: string; ar: string };

/** Figma source pills on the bilingual penalty / loan sheet. */
export type LayoutSource = "system" | "entry" | "fixed" | "signature";

export type LayoutFieldRow = {
  key: string;
  label: BilingualText;
  value: string;
  source?: LayoutSource;
};

export type LayoutCheckbox = {
  key: string;
  label: BilingualText;
  checked: boolean;
  note?: string;
};

export type LayoutSection = {
  key: string;
  title: BilingualText;
  rows: LayoutFieldRow[];
  checkboxes?: LayoutCheckbox[];
  body?: BilingualText;
  /**
   * A structural block on the reference form (loan request, HR verification,
   * management decision, accident dates). It prints its labels even when the
   * values are still blank, so a preview shows the form the rider will receive
   * and the PDF keeps the fields HR has to fill.
   */
  alwaysPrint?: boolean;
};

export type PayslipLineTone = "plain" | "days" | "net";

export type PayslipIdentityRow = {
  key: string;
  label: BilingualText;
  value: string;
};

export type PayslipLine = {
  key: string;
  code: string;
  name: BilingualText;
  rate: string;
  amount: string;
  tone: PayslipLineTone;
};

/** Identity grid plus the Code/Name | Rate | Amount table from frame 5873:14925. */
export type PayslipSheet = {
  identity: PayslipIdentityRow[];
  lines: PayslipLine[];
};

export type EsignDocumentLayout = {
  kind: EsignDocumentKind;
  title: BilingualText;
  masthead: { company: string; ref: string; date: string };
  employeeRows: LayoutFieldRow[];
  sections: LayoutSection[];
  declaration: BilingualText;
  slots: SignSlot[];
  payslip?: PayslipSheet;
  /** An Accident-family request (accident / sick leave / medical report / declaration). */
  accident?: boolean;
  /** Rider name printed in the accident tail; the template field wins over the snapshot. */
  riderName?: string;
  /** Absent on older layouts, which keep printing the declaration. */
  accidentRequestKind?: AccidentRequestKind | null;
  /** One requested document per line when the kind is not declaration. */
  requestedDocuments?: string[];
};

export type LayoutFieldInput = {
  key: string;
  labelEn: string;
  labelAr: string;
  value: string;
  section?: "employee" | "document";
  source?: LayoutSource;
  /** Author-controlled Penalty checkbox labels, when this is `penalty_action`. */
  options?: string[];
};

export type BuildLayoutInput = {
  kind?: unknown;
  headerEn?: string;
  headerAr?: string;
  bodyEn?: string;
  bodyAr?: string;
  declarationEn?: string;
  declarationAr?: string;
  description?: string;
  fields?: LayoutFieldInput[];
  employee: EsignEmployeeSnapshot;
  company?: string;
  dateLabel?: string;
  /** eSign request code (SIG-####). This is the Document ID on every sheet. */
  requestCode?: string;
};

/**
 * Fixed skeleton metrics for Figma `5931:4010` / `5931:4160`.
 * Duplicated in `functions/src/rpcs/esign-signature-slots.ts` — slot tests
 * fail if the two maps diverge. Extra template rows are appended after this
 * skeleton so they cannot move the named boxes `slotsForKind` stores.
 */
export const FIGMA_PAD_TOP = 20;
export const FIGMA_STACK = 2;
export const FIGMA_PAD_X = 24;
export const FIGMA_CONTENT_W = 547;
export const FIGMA_LABEL_COL = 168;
export const FIGMA_LABEL_GAP = 8;
export const FIGMA_LINE_W = 180;
export const FIGMA_LINE_H = 16;
export const FIGMA_ROW_H = 26;

export type FigmaGeom =
  | { h: number }
  | { h: number; line: "employee" }
  | { h: number; boxes: Array<{ role: SignSlotRole; w: number; boxH: number }> }
  | { h: number; decision: "hr" | "ceo"; boxW: number; boxH: number; dy: number }
  | { h: number; ack: "ack_received" | "ack_not_received"; boxW: number; boxH: number; dy: number };

const LINE_X = FIGMA_PAD_X + FIGMA_LABEL_COL + FIGMA_LABEL_GAP;
const LINE_DY = (FIGMA_ROW_H - FIGMA_LINE_H) / 2;

/** Geometry only — labels live in the HTML renderer. Keep in sync with Functions. */
export const PENALTY_GEOM: FigmaGeom[] = [
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

/** Bottom of the painted skeleton, including the pad and the stack under every row. */
export function figmaContentEndPt(steps: ReadonlyArray<{ h: number }>): number {
  return FIGMA_PAD_TOP + steps.reduce((sum, step) => sum + step.h + FIGMA_STACK, 0);
}

/**
 * Band under the skeleton and inside the A4 page.
 * Opening text, the declaration, and leftover rows sit here so they cannot
 * push the sheet onto a second page or move the named signature boxes.
 */
export function figmaTailBand(steps: ReadonlyArray<{ h: number }>): { top: number; height: number } {
  const top = figmaContentEndPt(steps) + 4;
  const height = Math.max(0, A4_HEIGHT_PT - top - 10);
  return { top, height };
}

export const LOAN_GEOM: FigmaGeom[] = [
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

export function slotsFromGeom(steps: FigmaGeom[]): SignSlot[] {
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

/** Ruled lines on the client sheet dock. Keep identical to functions/src/rpcs/esign-signature-slots.ts. */
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

const PAYSLIP_EM = "—";

const PAYSLIP_LINE_SPEC = [
  {
    key: "actual_working_days",
    aliases: ["actual_working_days", "actual_days"],
    code: "",
    nameEn: "Actual Working Days",
    nameAr: "أيام العمل الفعلية",
    tone: "days",
  },
  {
    key: "deduction_amount_kwd",
    aliases: ["deduction_amount_kwd", "administration_deduction", "admin_deduction"],
    code: "Ded",
    nameEn: "Administration deduction",
    nameAr: "خصم إداري",
    tone: "plain",
  },
  {
    key: "extra_input_kwd",
    aliases: ["extra_input_kwd", "extra_input"],
    code: "All",
    nameEn: "Extra Input",
    nameAr: "إدخال إضافي",
    tone: "plain",
  },
  {
    key: "basic_salary_kwd",
    aliases: ["basic_salary_kwd", "basic_salary"],
    code: "BASIC",
    nameEn: "Basic Salary",
    nameAr: "الراتب الأساسي",
    tone: "plain",
  },
  {
    key: "net_salary_kwd",
    aliases: ["net_salary_kwd", "net_salary"],
    code: "NET",
    nameEn: "Net Salary",
    nameAr: "صافي الراتب",
    tone: "net",
  },
] as const;

/** Last-four mask: `KW81…1041`. Short or empty numbers stay readable or an em dash. */
export function maskBankNumber(value: string | null | undefined): string {
  const compact = (value ?? "").replace(/\s+/g, "");
  if (!compact) return PAYSLIP_EM;
  if (compact.length <= 8) return compact;
  return `${compact.slice(0, 4)}…${compact.slice(-4)}`;
}

function payslipShown(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed || PAYSLIP_EM;
}

function payslipJoin(left: string, right: string): string {
  const a = left.trim();
  const b = right.trim();
  if (a && b) return `${a} / ${b}`;
  return a || b || PAYSLIP_EM;
}

function payslipField(fields: LayoutFieldInput[], keys: readonly string[]): string {
  for (const key of keys) {
    const hit = fields.find((field) => field.key === key);
    const value = hit?.value.trim() ?? "";
    if (value) return value;
  }
  return "";
}

export function buildPayslipSheet(
  values: Record<string, string>,
  fields: LayoutFieldInput[],
): PayslipSheet {
  const bank = maskBankNumber(values.bank_number);
  const identity: PayslipIdentityRow[] = [
    {
      key: "company",
      label: { en: "Company", ar: "الشركة" },
      value: payslipShown(values.company_name),
    },
    {
      key: "employee_position",
      label: { en: "Employee name / Position", ar: "اسم الموظف / الوظيفة" },
      value: payslipJoin(values.employee_name ?? "", values.position ?? ""),
    },
    {
      key: "civil_sponsor",
      label: { en: "Civil ID / Sponsor", ar: "الرقم المدني / الكفيل" },
      value: payslipJoin(values.civil_id ?? "", values.sponsor ?? ""),
    },
    {
      key: "pay_bank",
      label: { en: "Pay through / Bank account", ar: "طريقة الدفع / الحساب البنكي" },
      value: payslipJoin(values.pay_through ?? "", bank === PAYSLIP_EM ? "" : bank),
    },
    {
      key: "period",
      label: { en: "Period (From / To)", ar: "الفترة (من / إلى)" },
      value: payslipJoin(
        payslipField(fields, ["period_from", "date_from"]),
        payslipField(fields, ["period_to", "date_to"]),
      ),
    },
    {
      key: "computed_employee",
      label: { en: "Computed on / Employee ID", ar: "تاريخ الاحتساب / الرقم الوظيفي" },
      value: payslipJoin(payslipField(fields, ["computed_on"]), values.employee_id ?? ""),
    },
  ];

  const lines: PayslipLine[] = PAYSLIP_LINE_SPEC.map((spec) => {
    const amountRaw = payslipField(fields, spec.aliases);
    const numeric = Number(amountRaw.replace(/[^\d.-]/g, ""));
    const money = amountRaw && Number.isFinite(numeric) ? numeric.toFixed(2) : amountRaw;
    const amount =
      spec.tone === "days"
        ? amountRaw
          ? /day/i.test(amountRaw)
            ? amountRaw
            : `${amountRaw} Days`
          : PAYSLIP_EM
        : money
          ? /kd/i.test(money)
            ? money
            : `${money} KD`
          : PAYSLIP_EM;
    return {
      key: spec.key,
      code: spec.code,
      name: { en: spec.nameEn, ar: spec.nameAr },
      rate: spec.tone === "days" ? "" : "1.00",
      amount,
      tone: spec.tone,
    };
  });

  return { identity, lines };
}

/** Field keys already painted on the payslip identity grid or amount table. */
export function payslipConsumedKeys(): Set<string> {
  const keys = new Set<string>([
    "period_from",
    "date_from",
    "period_to",
    "date_to",
    "computed_on",
    "fixed_working_days",
    "fixed_days",
    "basic_salary_kwd",
    "basic_salary",
    "company_name",
    "company_name_ar",
    "employee_name",
    "employee_id",
    "position",
    "sponsor",
    "pay_through",
    "bank_number",
    "civil_id",
    "project",
    "slip_month",
    "hr_manager_name",
    "hr_manager_position",
    "computed_by",
  ]);
  for (const spec of PAYSLIP_LINE_SPEC) {
    for (const alias of spec.aliases) keys.add(alias);
  }
  return keys;
}

/** Which stamp box a signature field belongs on, from its key or English label. */
export function documentSignRole(
  key: string,
  labelEn: string,
): "employee" | "hr" | "gm" | "ceo" | null {
  const blob = `${key} ${labelEn}`.toLowerCase();
  if (blob.includes("employee")) return "employee";
  if (blob.includes("general manager") || blob.includes("general_manager") || blob.includes(" gm")) {
    return "gm";
  }
  if (blob.includes("ceo")) return "ceo";
  if (
    blob.includes("management") ||
    blob.includes("manager") ||
    blob.includes("hr") ||
    blob.includes("admin")
  ) {
    return "hr";
  }
  return null;
}

/** Employee Sign vs Management Sign. General Manager and CEO stay off the payslip pair. */
export function payslipSignRole(key: string, labelEn: string): "employee" | "hr" | null {
  const role = documentSignRole(key, labelEn);
  if (role === "employee" || role === "hr") return role;
  return null;
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

export function serializeSignatureSlots(slots: SignSlot[]): SignSlot[] {
  return slots.map((row) => ({ ...row }));
}

export function requireEmployeeSlot(slots: SignSlot[] | null | undefined): SignSlot {
  const found = slots?.find((row) => row.role === "employee" && isUsableSlot(row));
  if (!found) throw new Error(MISSING_EMPLOYEE_SLOT);
  return found;
}

/**
 * Employee stamp box. A usable persisted slot wins when the sheet version is
 * omitted or at least `ESIGN_SLOT_MEASURE_SINCE`. A null or older version
 * ignores persisted boxes and uses the kind fallback. Never invents
 * last-page bottom-right.
 */
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
  return requireEmployeeSlot(slotsForKind(normalizeDocumentKind(input.kind)));
}

/** HTML / preview page box. Figma top-left → CSS `top` / `left` in pt. */
export function slotPageBox(slot: SignSlot): { left: number; top: number; width: number; height: number } {
  return {
    left: slot.xPt,
    top: A4_HEIGHT_PT - slot.yPt - slot.hPt,
    width: slot.wPt,
    height: slot.hPt,
  };
}

export function resolveStampSlotForRole(
  role: SignSlotRole,
  input: { persisted?: unknown; kind?: unknown },
): SignSlot {
  const persisted = parseSignatureSlots(input.persisted);
  const fromPersisted = persisted?.find((row) => row.role === role && isUsableSlot(row));
  if (fromPersisted) return fromPersisted;
  const kind = normalizeDocumentKind(input.kind);
  const fromKind = slotsForKind(kind).find((row) => row.role === role && isUsableSlot(row));
  if (fromKind) return fromKind;
  throw new Error(role === "employee" ? MISSING_EMPLOYEE_SLOT : INVALID_SIGNATURE_SLOT);
}

/** Fit PNG inside the slot, preserve aspect ratio, centre, never overflow. */
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

export function isBottomRightFallback(box: SignSlot): boolean {
  const nearRight = box.xPt + box.wPt > A4_WIDTH_PT - 50;
  const nearBottom = box.yPt < 50;
  return nearRight && nearBottom;
}

function row(
  key: string,
  en: string,
  ar: string,
  value: string,
  source?: LayoutSource,
): LayoutFieldRow {
  return { key, label: { en, ar }, value, source };
}

function firstField(fields: LayoutFieldInput[], keys: string[]): string {
  for (const key of keys) {
    const found = fields.find((field) => field.key === key);
    const value = found?.value.trim() ?? "";
    if (value) return value;
  }
  return "";
}

function checksFromFields(fields: LayoutFieldInput[]): LayoutCheckbox[] {
  return checksFromPenaltyFields(fields);
}

function catalogueEmployeeRows(values: Record<string, string>): LayoutFieldRow[] {
  return [
    ...ESIGN_EMPLOYEE_CORE_ROWS.map((entry) =>
      row(entry.key, entry.label_en, entry.label_ar, values[entry.key] ?? ""),
    ),
    ...ESIGN_EMPLOYEE_ROWS.slice(ESIGN_EMPLOYEE_CORE_ROWS.length)
      .filter((entry) => (values[entry.key] ?? "").trim().length > 0)
      .map((entry) => row(entry.key, entry.label_en, entry.label_ar, values[entry.key] ?? "")),
  ];
}

function fillBoth(en: string, ar: string, merged: Record<string, string>): BilingualText {
  return { en: fillPlaceholders(en, merged), ar: fillPlaceholders(ar, merged) };
}

/** Opening paragraph, leftover fields, and author signature rows under a fixed skeleton. */
function foldTitleEcho(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.!?،؛]/g, "")
    .replace(/\s+/g, " ");
}

/** Seed bodies that only repeat the sheet title stay off the leftover tail. */
export function isTitleEcho(body: BilingualText, title: BilingualText): boolean {
  if (!body.en.trim() && !body.ar.trim()) return false;
  const en = foldTitleEcho(body.en);
  const ar = foldTitleEcho(body.ar);
  const titleEn = foldTitleEcho(title.en);
  const titleAr = foldTitleEcho(title.ar);
  const enEcho = !en || en === titleEn || en === titleAr;
  const arEcho = !ar || ar === titleAr || ar === titleEn;
  return enEcho && arEcho;
}

function leftoverValuePrints(value: string, title: BilingualText): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return !isTitleEcho({ en: trimmed, ar: "" }, title);
}

function appendAbsenceRange(sections: LayoutSection[], from: string, to: string) {
  const rows = [
    ...(from ? [row("absence_from", "From", "من", from, "entry")] : []),
    ...(to ? [row("absence_to", "To", "إلى", to, "entry")] : []),
  ];
  if (rows.length === 0) return;
  const appendix = sections.find((section) => section.key === "appendix");
  if (appendix) appendix.rows.unshift(...rows);
  else {
    sections.push({
      key: "appendix",
      title: { en: "Details", ar: "التفاصيل" },
      rows,
    });
  }
}

function appendDocumentTail(
  sections: LayoutSection[],
  fields: LayoutFieldInput[],
  consumed: Set<string>,
  body: BilingualText,
  title: BilingualText,
) {
  if ((body.en || body.ar) && !isTitleEcho(body, title)) {
    sections.push({
      key: "opening",
      title: { en: "Opening paragraph", ar: "الفقرة الافتتاحية" },
      rows: [],
      body,
    });
  }
  const extras = fields.filter(
    (field) =>
      field.source !== "signature" &&
      !consumed.has(field.key) &&
      leftoverValuePrints(field.value, title),
  );
  if (extras.length > 0) {
    sections.push({
      key: "appendix",
      title: { en: "Details", ar: "التفاصيل" },
      rows: extras.map((field) =>
        row(field.key, field.labelEn, field.labelAr || field.labelEn, field.value, field.source ?? "entry"),
      ),
    });
  }
  const signs = fields.filter((field) => field.source === "signature" && !consumed.has(field.key));
  if (signs.length > 0) {
    sections.push({
      key: "author_signs",
      title: { en: "Signatures", ar: "التواقيع" },
      rows: signs.map((field) =>
        row(field.key, field.labelEn, field.labelAr || field.labelEn, field.value, "signature"),
      ),
    });
  }
}

export function buildEsignDocumentLayout(input: BuildLayoutInput): EsignDocumentLayout {
  const kind = normalizeDocumentKind(input.kind);
  const values = snapshotValues(input.employee);
  const merged: Record<string, string> = { ...values };
  for (const field of input.fields ?? []) {
    merged[field.key] = field.value;
  }

  const header = fillBoth(input.headerEn ?? "", input.headerAr ?? "", merged);
  const accidentKindTitle = isAccidentRequest(merged, input.fields ?? [])
    ? accidentKindLabel(normalizeAccidentKind(merged[REQUEST_KIND_KEY]))
    : null;
  // The reference payslip is titled "Payslip". Older templates carried the
  // category label ("Salary Deduction Acknowledgement") as their header, which
  // is why the sheet looked unchanged; only a genuinely payslip-shaped header
  // is trusted over the default now.
  const payslipHeader = /payslip|salary slip|قسيمة/i.test(`${header.en} ${header.ar}`);
  const title: BilingualText = accidentKindTitle
    ? accidentKindTitle
    : kind === "payslip" && !payslipHeader
      ? { en: "Payslip", ar: "قسيمة الراتب" }
      : header.en || header.ar
        ? header
        : kind === "penalty"
          ? { en: "Penalty Notice", ar: "إشعار جزاء" }
          : kind === "loan"
            ? { en: "Loan Request", ar: "طلب سلفة" }
            : kind === "payslip"
              ? { en: "Payslip", ar: "قسيمة الراتب" }
              : { en: "Document", ar: "مستند" };

  const body = fillBoth(input.bodyEn ?? "", input.bodyAr ?? "", merged);
  const declaration = fillBoth(input.declarationEn ?? "", input.declarationAr ?? "", merged);
  const description = (input.description ?? "").trim();
  const allFields = input.fields ?? [];
  const documentFields = allFields.filter((field) => field.section !== "employee");
  const employeeFields = allFields.filter((field) => field.section === "employee");

  let employeeRows: LayoutFieldRow[];
  const sections: LayoutSection[] = [];
  let payslip: PayslipSheet | undefined;
  let accident = false;
  let riderName = "";
  let accidentRequestKind: AccidentRequestKind | null = null;
  let requestedDocuments: string[] = [];
  if (kind === "penalty") {
    const position = firstField(allFields, ["position"]) || values.project || "";
    const penaltyText =
      firstField(allFields, ["penalty", "penalty_text", "violation", "description"]) || description;
    const violationDate = firstField(allFields, ["penalty_date", "violation_date", "date_of_violation"]);
    const absenceFrom =
      firstField(allFields, ["absence_from", "absent_from", "from_date"]) ||
      (merged.absence_from ?? merged.absent_from ?? "").trim();
    const absenceTo =
      firstField(allFields, ["absence_to", "absent_to", "to_date"]) ||
      (merged.absence_to ?? merged.absent_to ?? "").trim();
    const repeated = firstField(allFields, ["repeated_penalty", "penalty_if_repeated", "penalty_repeated"]);
    const remarks = firstField(allFields, ["remarks", "notes"]);
    const othersAmount = firstField(allFields, ["others_amount", "others_amt", "other_amount"]);
    const penaltyChecks = checksFromFields(allFields).map((check) =>
      check.key === "others" && othersAmount ? { ...check, note: othersAmount } : check,
    );
    const actionValue = firstField(allFields, ["penalty_action", "penalty_type"]);
    const actionTokens = parsePenaltyActionTokens(actionValue);
    const actionMatched =
      actionTokens.length > 0 &&
      actionTokens.every((token) =>
        penaltyChecks.some(
          (check) =>
            token.toLowerCase() === check.key ||
            token.toLowerCase() === check.label.en.toLowerCase(),
        ),
      );
    employeeRows = [
      row("employee_name", "Employee Name", "اسم الموظف", values.employee_name ?? "", "system"),
      row("employee_number", "Employee Number", "رقم الموظف", values.employee_id ?? "", "system"),
      row("position", "Position", "الوظيفة", position, "system"),
      row("company", "Company", "الشركة", values.company_name ?? "", "system"),
      row("accommodation", "Accommodation", "السكن", values.accommodation ?? "", "system"),
    ];
    const consumed = new Set([
      "penalty",
      "penalty_text",
      "violation",
      "description",
      "penalty_date",
      "violation_date",
      "date_of_violation",
      "absence_from",
      "absence_to",
      "absent_from",
      "absent_to",
      "from_date",
      "to_date",
      "repeated_penalty",
      "penalty_if_repeated",
      "penalty_repeated",
      "remarks",
      "notes",
      "position",
      "employee_name",
      "employee_id",
      "employee_number",
      "company_name",
      "company",
      "accommodation",
      "others_amount",
      "others_amt",
      "other_amount",
      "optional_remark",
      "optional_remarks",
      "penalty_notice",
      PENALTY_VISIBLE_FIELD_KEY,
      ...PENALTY_CHECKS.map((check) => check.key),
      ...penaltyChecks.map((check) => check.key),
      ...(actionMatched ? ["penalty_action", "penalty_type"] : []),
    ]);
    sections.push(
      {
        key: "employee",
        title: { en: "Employee Information", ar: "بيانات الموظف" },
        rows: employeeRows,
      },
      {
        key: "penalty_details",
        title: { en: "Penalty Details", ar: "تفاصيل المخالفة" },
        rows: [
          row("penalty_text", "Penalty (English + Arabic)", "المخالفة (إنجليزي + عربي)", penaltyText, "entry"),
          row("violation_date", "Date of Violation", "تاريخ المخالفة", violationDate, "entry"),
          row("absence_from", "From", "من", absenceFrom, "entry"),
          row("absence_to", "To", "إلى", absenceTo, "entry"),
        ],
      },
      {
        key: "penalty",
        title: { en: "Penalty", ar: "الجزاء" },
        rows: [row("repeated", "Penalty if repeated", "العقوبة في حالة التكرار", repeated, "entry")],
        checkboxes: penaltyChecks,
      },
      {
        key: "management",
        title: { en: "Management Use Only", ar: "للاستخدام الإداري فقط" },
        rows: [],
      },
      {
        key: "remarks",
        title: { en: "Remarks", ar: "ملاحظات" },
        rows: [row("remarks", "Remarks", "ملاحظات", remarks, "entry")],
      },
    );
    appendDocumentTail(sections, [...employeeFields, ...documentFields], consumed, body, title);
    appendAbsenceRange(sections, absenceFrom, absenceTo);
    const overflow = penaltyChecks.slice(PENALTY_CHECK_SLOT_COUNT);
    if (overflow.length) {
      const extraRows = overflow.map((check) =>
        row(check.key, check.label.en, check.label.ar, check.checked ? "checked" : "", "entry"),
      );
      const appendix = sections.find((section) => section.key === "appendix");
      if (appendix) appendix.rows.push(...extraRows);
      else {
        sections.push({
          key: "appendix",
          title: { en: "Details", ar: "التفاصيل" },
          rows: extraRows,
        });
      }
    }
  } else if (kind === "loan") {
    const requestDate =
      firstField(allFields, ["request_date", "date_of_request", "loan_date"]) || input.dateLabel || "";
    const position = firstField(allFields, ["position"]) || values.project || "";
    const paymentMethod = firstField(allFields, ["payment_method", "payment", "pay_through"]);
    const installments = firstField(allFields, [
      "installments",
      "loan_tenure",
      "instalments_period",
      "installments_period",
      "tenure",
      "period",
    ]);
    const reason = firstField(allFields, [
      "reason",
      "loan_reason",
      "purpose",
      "loan_purpose",
      "purpose_of_loan",
      "remarks",
      "notes",
    ]);
    const monthlySalary = firstField(allFields, [
      "monthly_salary_kwd",
      "monthly_salary",
      "basic_salary_kwd",
      "basic_salary",
    ]);
    const monthlyInstallment = firstField(allFields, [
      "monthly_installment",
      "monthly_instalment",
      "installment_amount",
    ]);
    const yearsOfService =
      firstField(allFields, ["years_of_service", "service_years"]) || values.years_of_service || "";
    const department =
      firstField(allFields, ["department"]) || values.department || values.project || "";
    const policyCheck = firstField(allFields, ["policy_check", "policy_eligibility"]);
    const verifiedBy = firstField(allFields, ["verified_by", "hr_manager_name"]) || "";
    const verifiedDate = firstField(allFields, ["verified_date"]);
    const verifiedLine = verifiedDate || verifiedBy;
    employeeRows = [
      row("employee_name", "Employee name", "اسم الموظف", values.employee_name ?? "", "system"),
      row("employee_id", "Employee number", "رقم الموظف", values.employee_id ?? "", "system"),
      row("civil_id", "Civil ID number", "الرقم المدني", values.civil_id ?? "", "system"),
      row("company_name", "Company", "اسم الشركة", values.company_name ?? "", "system"),
      row("department", "Department", "القسم", department, "system"),
      row("position", "Position", "المهنة", position, "system"),
      row("joined_at", "Date of employment", "تاريخ التعيين", values.joined_at ?? "", "system"),
      row("request_date", "Application date", "تاريخ الطلب", requestDate, "fixed"),
    ];
    const loanRows: LayoutFieldRow[] = [
      row("monthly_salary_kwd", "Monthly salary (KWD)", "الراتب الشهري (د.ك)", monthlySalary, "system"),
      row("amount", "Amount requested (KWD)", "المبلغ المطلوب (د.ك)", firstField(allFields, ["amount", "requested_amount", "loan_amount"]), "entry"),
      row("installments", "Installments (months)", "عدد الأقساط", installments, "entry"),
      row("monthly_installment", "Monthly installment (KWD)", "القسط الشهري (د.ك)", monthlyInstallment, "entry"),
      row("payment_method", "Payment method", "طريقة الدفع", paymentMethod, "entry"),
      row("reason", "Reason / supporting document", "السبب / المستند المؤيد", reason || description, "entry"),
    ];
    const consumed = new Set([
      "request_date",
      "date_of_request",
      "loan_date",
      "sponsor",
      "employee_sponsor",
      "position",
      "department",
      "purpose",
      "loan_purpose",
      "purpose_of_loan",
      "reason",
      "loan_reason",
      "amount",
      "requested_amount",
      "loan_amount",
      "instalments_period",
      "installments_period",
      "installments",
      "loan_tenure",
      "tenure",
      "period",
      "instalments_start",
      "installments_start",
      "starting_month",
      "start_month",
      "loan_month",
      "month",
      "ending_time",
      "ending",
      "unsettled_loans",
      "unsettled",
      "payment_method",
      "payment",
      "pay_through",
      "remarks",
      "notes",
      "hr_decision",
      "ceo_decision",
      "ack_received_date",
      "ack_not_received_date",
      "employee_name",
      "employee_id",
      "company_name",
      "joined_at",
      "joining",
      "civil_id",
      "monthly_salary_kwd",
      "monthly_salary",
      "basic_salary_kwd",
      "basic_salary",
      "monthly_installment",
      "monthly_instalment",
      "installment_amount",
      "years_of_service",
      "service_years",
      "max_loan_policy_kwd",
      "max_loan_policy",
      "previous_loan_outstanding_kwd",
      "previous_loan_outstanding",
      "policy_check",
      "policy_eligibility",
      "verified_by",
      "verified_date",
      "hr_manager_name",
      "hr_manager_position",
      "management_decision",
      "amount_received",
    ]);
    sections.push(
      {
        key: "employee",
        title: { en: "Employee Information", ar: "بيانات الموظف" },
        rows: employeeRows,
        alwaysPrint: true,
      },
      {
        key: "loan",
        title: { en: "Loan Request", ar: "طلب السلفة" },
        rows: loanRows,
        alwaysPrint: true,
      },
      {
        key: "hr_verification",
        title: { en: "HR Verification", ar: "التحقق من الموارد البشرية" },
        alwaysPrint: true,
        rows: [
          row("years_of_service", "Years of service", "سنوات الخدمة", yearsOfService, "system"),
          row("max_loan_policy_kwd", "Maximum loan per policy (KWD)", "الحد الأقصى وفق السياسة", firstField(allFields, ["max_loan_policy_kwd", "max_loan_policy"]), "entry"),
          row("previous_loan_outstanding_kwd", "Previous loan outstanding (KWD)", "رصيد سلفة سابقة", firstField(allFields, ["previous_loan_outstanding_kwd", "previous_loan_outstanding"]), "entry"),
          row("policy_check", "Policy check", "نتيجة التحقق", policyCheck, "entry"),
          row("verified_by_date", "Verified by / date", "تم التحقق بواسطة / التاريخ", verifiedLine, "entry"),
        ],
      },
      {
        key: "management_decision",
        title: { en: "Management Decision", ar: "قرار الإدارة" },
        alwaysPrint: true,
        rows: [
          row("hr_manager_name", "HR Manager", "مدير الموارد البشرية", firstField(allFields, ["hr_manager_name"]) || verifiedBy, "entry"),
          row("hr_manager_position", "Position", "المنصب", firstField(allFields, ["hr_manager_position"]), "entry"),
          row("management_decision", "Decision", "القرار", firstField(allFields, ["management_decision", "hr_decision"]), "entry"),
          row("amount_received", "Amount Received", "المبلغ المستلم", firstField(allFields, ["amount_received"]), "entry"),
          row("ceo_decision", "CEO Decision", "قرار الرئيس التنفيذي", firstField(allFields, ["ceo_decision"]), "signature"),
        ],
      },
      {
        key: "ack",
        title: { en: "Acknowledgement", ar: "الإقرار" },
        rows: [
          row("ack_received_date", "Date", "التاريخ", firstField(allFields, ["ack_received_date"]), "entry"),
          row("ack_not_received_date", "Date", "التاريخ", firstField(allFields, ["ack_not_received_date"]), "entry"),
        ],
      },
    );
    appendDocumentTail(sections, [...employeeFields, ...documentFields], consumed, body, title);
  } else if (kind === "payslip") {
    payslip = buildPayslipSheet(values, documentFields);
    employeeRows = payslip.identity.map((item) =>
      row(item.key, item.label.en, item.label.ar, item.value, "system"),
    );
    sections.push({
      key: "payslip",
      title: { en: "Amount", ar: "المبلغ" },
      rows: payslip.lines.map((line) =>
        row(
          line.key,
          line.code ? `${line.code} — ${line.name.en}` : line.name.en,
          line.code ? `${line.code} — ${line.name.ar}` : line.name.ar,
          `${line.rate} · ${line.amount}`,
          "entry",
        ),
      ),
    });
    sections.push({
      key: "payslip_verification",
      title: { en: "Verification", ar: "التحقق" },
      alwaysPrint: true,
      rows: [
        row("hr_manager_name", "HR Manager", "مدير الموارد البشرية", firstField(allFields, ["hr_manager_name"]), "entry"),
        row("hr_manager_position", "Position", "المنصب", firstField(allFields, ["hr_manager_position"]), "entry"),
        row("computed_by", "Computed By", "احتسب بواسطة", firstField(allFields, ["computed_by"]), "entry"),
      ],
    });
    // Individual values for the reference voucher grid. The generic renderer
    // is bypassed for payslips, so these rows are a data supply, not a block.
    sections.push({
      key: "payslip_fields",
      title: { en: "Payslip fields", ar: "حقول القسيمة" },
      rows: [
        row("company_name", "Company", "الشركة", values.company_name ?? "", "system"),
        row("company_name_ar", "Company (Arabic)", "اسم الشركة بالعربية", firstField(allFields, ["company_name_ar"]), "entry"),
        row("employee_name", "Name", "الاسم", values.employee_name ?? "", "system"),
        row("position", "Position", "الوظيفة", firstField(allFields, ["position"]) || values.position || "", "system"),
        row("civil_id", "Civil ID", "الرقم المدني", values.civil_id ?? "", "system"),
        row("employee_id", "Employee ID", "رقم الموظف", values.employee_id ?? "", "system"),
        row("pay_through", "Pay Through", "طريقة الدفع", firstField(allFields, ["pay_through"]) || values.pay_through || "", "system"),
        row("bank_number", "Bank Number", "رقم البنك", firstField(allFields, ["bank_number"]) || values.bank_number || "", "system"),
        row("date_from", "Date From", "من تاريخ", firstField(allFields, ["period_from", "date_from"]), "entry"),
        row("date_to", "Date To", "إلى تاريخ", firstField(allFields, ["period_to", "date_to"]), "entry"),
        row("computed_on", "Computed On", "تاريخ الاحتساب", firstField(allFields, ["computed_on"]), "entry"),
        row("fixed_working_days", "Fixed Monthly Working Days", "أيام العمل الشهرية", firstField(allFields, ["fixed_working_days", "fixed_days"]), "entry"),
        row("basic_salary", "Basic Salary", "الراتب الأساسي", firstField(allFields, ["basic_salary_kwd", "basic_salary"]), "entry"),
        row("slip_month", "Month", "الشهر", firstField(allFields, ["slip_month"]), "entry"),
        row("hr_manager_name", "HR Manager", "مدير الموارد البشرية", firstField(allFields, ["hr_manager_name"]), "entry"),
      ],
    });
    if ((body.en || body.ar) && !isTitleEcho(body, title)) {
      sections.push({
        key: "opening",
        title: { en: "Opening paragraph", ar: "الفقرة الافتتاحية" },
        rows: [],
        body,
      });
    }
    const consumed = payslipConsumedKeys();
    const extras = documentFields.filter(
      (field) =>
        field.source !== "signature" &&
        !consumed.has(field.key) &&
        leftoverValuePrints(field.value, title),
    );
    if (extras.length > 0) {
      sections.push({
        key: "payslip_extra",
        title: { en: "Details", ar: "التفاصيل" },
        rows: extras.map((field) =>
          row(field.key, field.labelEn, field.labelAr || field.labelEn, field.value, field.source ?? "entry"),
        ),
      });
    }
    const signs = documentFields.filter((field) => field.source === "signature");
    if (signs.length > 0) {
      sections.push({
        key: "payslip_signs",
        title: { en: "Signatures", ar: "التواقيع" },
        rows: signs.map((field) =>
          row(field.key, field.labelEn, field.labelAr || field.labelEn, field.value, "signature"),
        ),
      });
    }
  } else if (isAccidentRequest(merged, allFields)) {
    accident = true;
    const rawKind = typeof merged[REQUEST_KIND_KEY] === "string" ? merged[REQUEST_KIND_KEY].trim() : "";
    accidentRequestKind = ACCIDENT_REQUEST_KINDS.some((entry) => entry.value === rawKind)
      ? (rawKind as AccidentRequestKind)
      : null;
    requestedDocuments = requestedDocumentLines(merged.requested_documents);
    const requestKind = normalizeAccidentKind(rawKind);
    const kindLabel = accidentKindLabel(requestKind);
    const sickLeave = requestKind === "sick_leave";
    const accidentDate =
      firstField(allFields, ["accident_date"]) || (merged.accident_date ?? "").trim();
    const reportDate =
      firstField(allFields, ["report_date"]) || (merged.report_date ?? "").trim();
    const absenceFrom =
      firstField(allFields, ["absence_from", "absent_from"]) ||
      (merged.absence_from ?? merged.absent_from ?? "").trim();
    const absenceTo =
      firstField(allFields, ["absence_to", "absent_to"]) ||
      (merged.absence_to ?? merged.absent_to ?? "").trim();

    employeeRows = accidentEmployeeRows(values).map((entry) =>
      row(entry.key, entry.label_en, entry.label_ar, entry.value, "system"),
    );
    // The section header is the selected kind; the rows are that kind's dates.
    sections.push({
      key: "request_details",
      title: kindLabel,
      alwaysPrint: true,
      rows: sickLeave
        ? [
            row("absence_from", "From", "من", absenceFrom, "entry"),
            row("absence_to", "To", "إلى", absenceTo, "entry"),
          ]
        : [
            row("accident_date", "Accident date", "تاريخ الحادث", accidentDate, "entry"),
            row("report_date", "Report date", "تاريخ التقرير", reportDate, "entry"),
          ],
    });
    const riderNameValue = firstField(allFields, ["rider_name"]) || values.employee_name || "";
    riderName = riderNameValue;
    if (!accidentRequestKind || accidentRequestKind === "declaration") {
      const declarationEn = declaration.en.trim();
      const declarationAr = declaration.ar.trim();
      sections.push({
        key: "rider_declaration",
        title: { en: "Rider Declaration", ar: "إقرار السائق" },
        rows: [],
        body:
          declarationEn || declarationAr
            ? { en: declarationEn, ar: declarationAr }
            : undefined,
      });
    }
    const consumed = new Set<string>([
      ...ACCIDENT_CONSUMED_KEYS,
      ...ACCIDENT_EMPLOYEE_ROW_KEYS,
      "rider_name",
      // Deliberately off this kind, so a template field cannot reprint them.
      "company_name",
      "joined_at",
      "accommodation",
      "zone",
      "project",
      "nationality",
      "department",
    ]);
    appendDocumentTail(sections, [...employeeFields, ...documentFields], consumed, body, title);
  } else {
    employeeRows = catalogueEmployeeRows(values);
    for (const field of employeeFields) {
      if (field.source === "signature") continue;
      employeeRows.push(row(field.key, field.labelEn, field.labelAr || field.labelEn, field.value, field.source));
    }
    if ((body.en || body.ar) && !isTitleEcho(body, title)) {
      sections.push({
        key: "opening",
        title: { en: "Opening paragraph", ar: "الفقرة الافتتاحية" },
        rows: [],
        body,
      });
    }
    const signs = [...employeeFields, ...documentFields].filter((field) => field.source === "signature");
    const rest = documentFields.filter(
      (field) => field.source !== "signature" && leftoverValuePrints(field.value, title),
    );
    const descBody =
      !body.en && !body.ar && description.trim() ? { en: description, ar: description } : undefined;
    if (rest.length > 0 || descBody) {
      sections.push({
        key: "document",
        title: { en: "Details", ar: "التفاصيل" },
        rows: rest.map((field) =>
          row(field.key, field.labelEn, field.labelAr || field.labelEn, field.value, field.source ?? "entry"),
        ),
        body: descBody,
      });
    }
    if (signs.length > 0) {
      sections.push({
        key: "author_signs",
        title: { en: "Signatures", ar: "التواقيع" },
        rows: signs.map((field) =>
          row(field.key, field.labelEn, field.labelAr || field.labelEn, field.value, "signature"),
        ),
      });
    }
  }

  return {
    kind,
    title,
    masthead: {
      company: input.company || values.company_name || "MG GO",
      ref: input.requestCode?.trim() || "—",
      date: input.dateLabel || "",
    },
    employeeRows,
    sections,
    declaration,
    slots: slotsForKind(kind),
    ...(payslip ? { payslip } : {}),
    ...(accident
      ? {
          accident: true,
          riderName,
          ...(accidentRequestKind ? { accidentRequestKind, requestedDocuments } : {}),
        }
      : {}),
  };
}

export function bilingualTitle(title: BilingualText): string {
  if (title.en && title.ar && title.en !== title.ar) return `${title.en} — ${title.ar}`;
  return title.en || title.ar;
}
