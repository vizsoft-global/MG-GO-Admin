import { normalizeDocumentKind } from "../document-kind";
import { ESIGN_EMPLOYEE_CORE_ROWS, ESIGN_EMPLOYEE_ROWS } from "../employee-block";
import type { EsignDocumentKind } from "../types";
import type { EsignEmployeeSnapshot } from "./esign-placeholders";
import { fillPlaceholders, snapshotValues } from "./esign-placeholders";

/** A4 portrait in PDF points — Figma D1/D2 frames are 595×842. */
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
};

export type LayoutSection = {
  key: string;
  title: BilingualText;
  rows: LayoutFieldRow[];
  checkboxes?: LayoutCheckbox[];
  body?: BilingualText;
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
};

export type LayoutFieldInput = {
  key: string;
  labelEn: string;
  labelAr: string;
  value: string;
  section?: "employee" | "document";
  source?: LayoutSource;
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
};

/**
 * Figma `5931:4010` checkbox list. English only on the sheet; Arabic stays
 * empty so a filled option does not grow a second line the frame does not draw.
 * `deduct_1_day`…`deduct_5_day` replace the old combined `deduct_1_5` row.
 */
export const PENALTY_CHECKS: LayoutCheckbox[] = [
  { key: "written_warning", label: { en: "Written warning", ar: "" }, checked: false },
  { key: "deduct_10", label: { en: "10% deduction of a day's salary", ar: "" }, checked: false },
  { key: "deduct_25", label: { en: "25% deduction of a day's salary", ar: "" }, checked: false },
  { key: "deduct_50", label: { en: "50% deduction of a day's salary", ar: "" }, checked: false },
  { key: "deduct_1_day", label: { en: "One day deduction", ar: "" }, checked: false },
  { key: "deduct_2_day", label: { en: "Two days deduction", ar: "" }, checked: false },
  { key: "deduct_3_day", label: { en: "Three days deduction", ar: "" }, checked: false },
  { key: "deduct_4_day", label: { en: "Four days deduction", ar: "" }, checked: false },
  { key: "deduct_5_day", label: { en: "Five days deduction", ar: "" }, checked: false },
  { key: "dismissal_warning", label: { en: "Dismissal final warning", ar: "" }, checked: false },
  { key: "others", label: { en: "Others", ar: "" }, checked: false },
];

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

/** Figma D1 `5931:4010` — employee underline, then HR / GM boxes. */
export const PENALTY_SLOTS: SignSlot[] = slotsFromGeom(PENALTY_GEOM);

/** Figma D2 `5931:4160` — employee underline, HR/CEO, acknowledgement boxes. */
export const LOAN_SLOTS: SignSlot[] = slotsFromGeom(LOAN_GEOM);

export const PAYSLIP_SLOTS: SignSlot[] = [
  slot("employee", "employee", 620, 48, 499, 22),
  slot("hr", "hr", 670, 48, 140, 36),
];

export const GENERAL_SLOTS: SignSlot[] = [
  slot("employee", "employee", 620, 48, 499, 22),
  slot("hr", "hr", 670, 48, 140, 36),
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
    {
      key: "fixed_days",
      label: { en: "Fixed Monthly Working Days", ar: "أيام العمل الشهرية الثابتة" },
      value: payslipShown(payslipField(fields, ["fixed_working_days", "fixed_days"])),
    },
    {
      key: "basic_salary",
      label: { en: "Basic Salary", ar: "الراتب الأساسي" },
      value: payslipShown(payslipField(fields, ["basic_salary_kwd", "basic_salary"])),
    },
  ];

  const lines: PayslipLine[] = PAYSLIP_LINE_SPEC.map((spec) => {
    const amountRaw = payslipField(fields, spec.aliases);
    const amount =
      spec.tone === "days" && amountRaw && !/day/i.test(amountRaw)
        ? `${amountRaw} days`
        : payslipShown(amountRaw);
    return {
      key: spec.key,
      code: spec.code,
      name: { en: spec.nameEn, ar: spec.nameAr },
      rate: "1.00",
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
    "employee_name",
    "employee_id",
    "position",
    "sponsor",
    "pay_through",
    "bank_number",
    "civil_id",
    "project",
    "slip_month",
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

/**
 * Employee stamp box. Persisted slots win when usable; otherwise recompute
 * from `document_kind`. Never invents last-page bottom-right.
 */
export function requireEmployeeSlot(slots: SignSlot[] | null | undefined): SignSlot {
  const found = slots?.find((row) => row.role === "employee" && isUsableSlot(row));
  if (!found) throw new Error(MISSING_EMPLOYEE_SLOT);
  return found;
}

export function resolveEmployeeStampSlot(input: {
  persisted?: unknown;
  kind?: unknown;
}): SignSlot {
  const persisted = parseSignatureSlots(input.persisted);
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

function isCheckedToken(value: string): boolean {
  const token = value.trim().toLowerCase();
  return token === "1" || token === "true" || token === "yes" || token === "checked" || token === "on";
}

function checksFromFields(fields: LayoutFieldInput[]): LayoutCheckbox[] {
  return PENALTY_CHECKS.map((check) => {
    const checked = fields.some((field) => {
      const value = field.value.trim();
      const lower = value.toLowerCase();
      if (field.key === check.key && isCheckedToken(value)) return true;
      if (lower === check.key) return true;
      if (check.label.en && lower === check.label.en.toLowerCase()) return true;
      return false;
    });
    return { ...check, checked };
  });
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
function appendDocumentTail(
  sections: LayoutSection[],
  fields: LayoutFieldInput[],
  consumed: Set<string>,
  body: BilingualText,
) {
  if (body.en || body.ar) {
    sections.push({
      key: "opening",
      title: { en: "Opening paragraph", ar: "الفقرة الافتتاحية" },
      rows: [],
      body,
    });
  }
  const extras = fields.filter((field) => field.source !== "signature" && !consumed.has(field.key));
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
  const title: BilingualText =
    header.en || header.ar
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
  if (kind === "penalty") {
    const position = firstField(allFields, ["position"]) || values.project || "";
    const penaltyText =
      firstField(allFields, ["penalty", "penalty_text", "violation", "description"]) || description;
    const violationDate = firstField(allFields, ["penalty_date", "violation_date", "date_of_violation"]);
    const repeated = firstField(allFields, ["repeated_penalty", "penalty_if_repeated", "penalty_repeated"]);
    const remarks = firstField(allFields, ["remarks", "notes"]);
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
      ...PENALTY_CHECKS.map((check) => check.key),
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
        ],
      },
      {
        key: "penalty",
        title: { en: "Penalty", ar: "الجزاء" },
        rows: [row("repeated", "Penalty if repeated", "العقوبة في حالة التكرار", repeated, "entry")],
        checkboxes: checksFromFields(allFields),
      },
      {
        key: "management",
        title: { en: "Management Use Only", ar: "" },
        rows: [],
      },
      {
        key: "remarks",
        title: { en: "Remarks", ar: "ملاحظات" },
        rows: [row("remarks", "Remarks", "ملاحظات", remarks, "entry")],
      },
    );
    appendDocumentTail(sections, [...employeeFields, ...documentFields], consumed, body);
  } else if (kind === "loan") {
    const requestDate =
      firstField(allFields, ["request_date", "date_of_request", "loan_date"]) || input.dateLabel || "";
    const sponsor = firstField(allFields, ["sponsor", "employee_sponsor"]) || values.company_name || "";
    const position = firstField(allFields, ["position"]) || values.project || "";
    employeeRows = [
      row("request_date", "Date of Request", "تاريخ الطلب", requestDate, "fixed"),
      row("employee_id", "Employee ID", "رقم الموظف", values.employee_id ?? "", "system"),
      row("employee_name", "Employee Name", "اسم الموظف", values.employee_name ?? "", "system"),
      row("sponsor", "Employee's Sponsor", "كفيل الموظف", sponsor, "system"),
      row("joining", "Joining Date", "تاريخ الالتحاق", values.joined_at ?? "", "system"),
      row("position", "Position", "الوظيفة", position, "system"),
    ];
    const loanRows: LayoutFieldRow[] = [
      row("purpose", "Purpose of Loan", "الغرض من السلفة", firstField(allFields, ["purpose", "loan_purpose", "purpose_of_loan"]), "entry"),
      row("amount", "Requested Amount", "المبلغ المطلوب", firstField(allFields, ["amount", "requested_amount", "loan_amount"]), "entry"),
      row("period", "Instalments Period", "فترة الأقساط", firstField(allFields, ["instalments_period", "installments_period", "tenure", "period"]), "entry"),
      row("start_month", "Instalments Starting Month", "شهر بداية الأقساط", firstField(allFields, ["instalments_start", "installments_start", "starting_month", "start_month"]), "entry"),
      row("ending", "Ending Time", "وقت الانتهاء", firstField(allFields, ["ending_time", "ending"]), "fixed"),
      row("unsettled", "Unsettled Loans if any", "سلف غير مسددة إن وجدت", firstField(allFields, ["unsettled_loans", "unsettled"]), "system"),
    ];
    const consumed = new Set([
      "request_date",
      "date_of_request",
      "loan_date",
      "sponsor",
      "employee_sponsor",
      "position",
      "purpose",
      "loan_purpose",
      "purpose_of_loan",
      "amount",
      "requested_amount",
      "loan_amount",
      "instalments_period",
      "installments_period",
      "tenure",
      "period",
      "instalments_start",
      "installments_start",
      "starting_month",
      "start_month",
      "ending_time",
      "ending",
      "unsettled_loans",
      "unsettled",
      "payment_method",
      "payment",
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
    ]);
    sections.push(
      {
        key: "employee",
        title: { en: "Employee Details", ar: "بيانات الموظف" },
        rows: employeeRows,
      },
      {
        key: "loan",
        title: { en: "Loan Details", ar: "تفاصيل السلفة" },
        rows: loanRows,
        body: description ? { en: description, ar: description } : undefined,
      },
      {
        key: "approval",
        title: { en: "Approval Status", ar: "حالة الموافقة" },
        rows: [
          row("hr_decision", "HR Decision", "قرار الموارد البشرية", firstField(allFields, ["hr_decision"]), "signature"),
          row("ceo_decision", "CEO Decision", "قرار الرئيس التنفيذي", firstField(allFields, ["ceo_decision"]), "signature"),
        ],
      },
      {
        key: "payment",
        title: { en: "Payment Method", ar: "طريقة الدفع" },
        rows: [
          row("payment", "Payment Method", "طريقة الدفع", firstField(allFields, ["payment_method", "payment"]), "entry"),
          row("remarks", "Remarks", "ملاحظات", firstField(allFields, ["remarks", "notes"]), "entry"),
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
    appendDocumentTail(sections, [...employeeFields, ...documentFields], consumed, body);
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
    if (body.en || body.ar) {
      sections.push({
        key: "opening",
        title: { en: "Opening paragraph", ar: "الفقرة الافتتاحية" },
        rows: [],
        body,
      });
    }
    const consumed = payslipConsumedKeys();
    const extras = documentFields.filter(
      (field) => field.source !== "signature" && !consumed.has(field.key),
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
  } else {
    employeeRows = catalogueEmployeeRows(values);
    for (const field of employeeFields) {
      if (field.source === "signature") continue;
      employeeRows.push(row(field.key, field.labelEn, field.labelAr || field.labelEn, field.value, field.source));
    }
    if (body.en || body.ar) {
      sections.push({
        key: "opening",
        title: { en: "Opening paragraph", ar: "الفقرة الافتتاحية" },
        rows: [],
        body,
      });
    }
    const signs = [...employeeFields, ...documentFields].filter((field) => field.source === "signature");
    const rest = documentFields.filter((field) => field.source !== "signature");
    sections.push({
      key: "document",
      title: { en: "Details", ar: "التفاصيل" },
      rows: rest.map((field) =>
        row(field.key, field.labelEn, field.labelAr || field.labelEn, field.value, field.source ?? "entry"),
      ),
      body: !body.en && !body.ar && description ? { en: description, ar: description } : undefined,
    });
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
      ref: values.employee_id || "—",
      date: input.dateLabel || "",
    },
    employeeRows,
    sections,
    declaration,
    slots: slotsForKind(kind),
    ...(payslip ? { payslip } : {}),
  };
}

export function bilingualTitle(title: BilingualText): string {
  if (title.en && title.ar && title.en !== title.ar) return `${title.en} — ${title.ar}`;
  return title.en || title.ar;
}
