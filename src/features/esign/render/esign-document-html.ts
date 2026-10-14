import {
  bilingualTitle,
  buildEsignDocumentLayout,
  figmaTailBand,
  GENERAL_SLOTS,
  LOAN_GEOM,
  PENALTY_GEOM,
  documentSignRole,
  payslipSignRole,
  slotPageBox,
  type BuildLayoutInput,
  type BilingualText,
  type EsignDocumentLayout,
  type LayoutCheckbox,
  type LayoutFieldRow,
  type LayoutSource,
  type SignSlot,
  type SignSlotRole,
} from "./esign-document-layout";
import { PENALTY_CHECK_SLOT_COUNT } from "../esign-penalty-checks";
import {
  type EsignEmployeeSnapshot,
  escapeHtml,
} from "./esign-placeholders";

export const SIGNATURE_BAND_PT = 140;

/** Inline MG mark when Settings has no logo, or `/logo.png` is missing from public/. */
export const ESIGN_DEFAULT_LOGO_SRC =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 24"><rect width="24" height="24" rx="4" fill="#18181b"/><path fill="#fff" d="M5 17.5V6.5h3.2l3.8 8 3.8-8H19v11h-2.4V9.6l-3.5 7.9h-2.2L7.4 9.6v7.9H5z"/></svg>`,
  );

export function resolveEsignLogoSrc(url?: string | null): string {
  const trimmed = url?.trim() ?? "";
  if (!trimmed || trimmed === "/logo.png") return ESIGN_DEFAULT_LOGO_SRC;
  return trimmed;
}

function logoMarkup(url?: string | null): string {
  return `<img class="logo-img" data-logo="1" src="${escapeHtml(resolveEsignLogoSrc(url))}" alt=""/>`;
}

function stackPair(en: string, ar: string): string {
  const e = en.trim();
  const a = ar.trim();
  if (e && a && e !== a) {
    return `<span class="stack"><span class="stack-en">${escapeHtml(e)}</span><span class="stack-ar" dir="rtl">${escapeHtml(a)}</span></span>`;
  }
  return `<span class="stack"><span class="stack-en">${escapeHtml(e || a)}</span></span>`;
}

function stackBody(text: BilingualText): string {
  const e = text.en.trim();
  const a = text.ar.trim();
  if (e && a && e !== a) {
    return `<p class="stack-en">${escapeHtml(e)}</p><p class="stack-ar" dir="rtl">${escapeHtml(a)}</p>`;
  }
  return `<p>${escapeHtml(e || a)}</p>`;
}

export type EsignRenderLanguage = "en" | "ar";

export type EsignRenderField = {
  key: string;
  label: string;
  labelEn?: string;
  labelAr?: string;
  value: string;
  section?: "employee" | "document";
  source?: LayoutSource;
  options?: string[];
};

export type EsignDocumentInput = {
  language?: EsignRenderLanguage;
  header?: string;
  headerEn?: string;
  headerAr?: string;
  body?: string;
  bodyEn?: string;
  bodyAr?: string;
  declaration?: string;
  declarationEn?: string;
  declarationAr?: string;
  description?: string;
  fields?: EsignRenderField[];
  employee: EsignEmployeeSnapshot;
  kind?: unknown;
  company?: string;
  dateLabel?: string;
  fontCss?: string;
  logoUrl?: string | null;
  staffLabel?: string;
};

/**
 * The bottom skeleton labels. Preview i18n is asserted against these
 * (`signature-band-labels.test.ts`). The delivered page prints both locales
 * on one sheet — Arabic is a `dir=rtl` span, never `html[dir=rtl]`.
 */
export const ESIGN_BOTTOM_LABELS = {
  en: {
    employeeSignature: "Employee Authorized signature",
    staffSignature: "HR signature",
    managementUseOnly: "Management Use Only",
    ceoDecision: "CEO Decision",
    approved: "Approved",
    notApproved: "Not approved",
    hrAdmin: "HR / Admin Department",
    generalManager: "General Manager",
    approvalStatus: "Approval Status",
    decision: "Decision",
    signatureDate: "Signature and date",
  },
  ar: {
    employeeSignature: "توقيع الموظف المعتمد",
    staffSignature: "توقيع الموارد البشرية",
    managementUseOnly: "للاستخدام الإداري فقط",
    ceoDecision: "قرار الرئيس التنفيذي",
    approved: "موافق",
    notApproved: "غير موافق",
    hrAdmin: "إدارة الموارد البشرية / الإدارة",
    generalManager: "المدير العام",
    approvalStatus: "حالة الموافقة",
    decision: "القرار",
    signatureDate: "التوقيع والتاريخ",
  },
} as const;

const BOTTOM = ESIGN_BOTTOM_LABELS;

const SLOT_CAPTION: Record<SignSlotRole, BilingualText> = {
  employee: { en: BOTTOM.en.employeeSignature, ar: BOTTOM.ar.employeeSignature },
  hr: { en: BOTTOM.en.hrAdmin, ar: BOTTOM.ar.hrAdmin },
  gm: { en: BOTTOM.en.generalManager, ar: BOTTOM.ar.generalManager },
  ceo: { en: BOTTOM.en.ceoDecision, ar: BOTTOM.ar.ceoDecision },
  ack_received: { en: "Amount received", ar: "تم الاستلام" },
  ack_not_received: { en: "Amount not received", ar: "لم يُستلم" },
};

export function documentInputToLayout(input: EsignDocumentInput): EsignDocumentLayout {
  const language = input.language ?? "en";
  return buildEsignDocumentLayout({
    kind: input.kind,
    headerEn: input.headerEn ?? (language !== "ar" ? input.header ?? "" : ""),
    headerAr: input.headerAr ?? (language === "ar" ? input.header ?? "" : ""),
    bodyEn: input.bodyEn ?? (language !== "ar" ? input.body ?? "" : ""),
    bodyAr: input.bodyAr ?? (language === "ar" ? input.body ?? "" : ""),
    declarationEn: input.declarationEn ?? (language !== "ar" ? input.declaration ?? "" : ""),
    declarationAr: input.declarationAr ?? (language === "ar" ? input.declaration ?? "" : ""),
    description: input.description,
    fields: (input.fields ?? []).map((field) => ({
      key: field.key,
      labelEn: field.labelEn ?? field.label,
      labelAr: field.labelAr || field.labelEn || field.label,
      value: field.value,
      section: field.section,
      ...(field.source ? { source: field.source } : {}),
      ...(field.options?.length ? { options: field.options } : {}),
    })),
    employee: input.employee,
    company: input.company,
    dateLabel: input.dateLabel,
  } satisfies BuildLayoutInput);
}

function pair(text: BilingualText): string {
  const en = escapeHtml(text.en);
  const ar = escapeHtml(text.ar);
  if (en && ar && en !== ar) {
    return `<span class="en">${en}</span><span class="sep"> — </span><span class="ar" dir="rtl">${ar}</span>`;
  }
  if (ar && !en) return `<span class="ar" dir="rtl">${ar}</span>`;
  return `<span class="en">${en || ar}</span>`;
}

function kvRow(item: LayoutFieldRow): string {
  return `<div class="kv"><span class="lbl">${pair(item.label)}</span><span class="val">${escapeHtml(item.value) || "—"}</span></div>`;
}

function stackKvRow(item: LayoutFieldRow): string {
  return `<div class="kv"><span class="lbl">${stackPair(item.label.en, item.label.ar)}</span><span class="val">${escapeHtml(item.value) || "—"}</span></div>`;
}

function sheetFootMarkup(logoUrl?: string | null, ref = "Form Ref.: MG HR Ref Emp. 0011"): string {
  return `<div class="sheet-foot" data-sheet-foot="1"><span class="ref">${escapeHtml(ref)}</span>${logoMarkup(logoUrl)}</div>`;
}

function staffCaption(staffLabel: string | undefined, fallback: BilingualText): BilingualText {
  const name = staffLabel?.trim();
  if (name) return { en: name, ar: name };
  return fallback;
}

function slotMarkup(slot: SignSlot, caption?: BilingualText, staffLabel?: string): string {
  const box = slotPageBox(slot);
  const fallback = caption ?? SLOT_CAPTION[slot.role];
  const text = slot.role === "hr" ? staffCaption(staffLabel, fallback) : fallback;
  return `<div class="slot" data-slot-role="${escapeHtml(slot.role)}" style="left:${box.left}pt;top:${box.top}pt;width:${box.width}pt;height:${box.height}pt"><p class="slot-cap">${pair(text)}</p></div>`;
}

export function buildEsignDocumentHtml(input: EsignDocumentInput): string {
  const layout = documentInputToLayout(input);
  return renderLayoutHtml(layout, input.fontCss, input.logoUrl, input.staffLabel);
}

function findRow(layout: EsignDocumentLayout, key: string): LayoutFieldRow | undefined {
  for (const section of layout.sections) {
    const found = section.rows.find((item) => item.key === key);
    if (found) return found;
  }
  return layout.employeeRows.find((item) => item.key === key);
}

function sourceTag(source: LayoutSource | undefined): string {
  const kind = source ?? "entry";
  switch (kind) {
    case "system":
      return `<span class="tag tag-system">From the system</span>`;
    case "entry":
      return `<span class="tag tag-entry">You enter</span>`;
    case "fixed":
      return `<span class="tag tag-fixed">Fixed</span>`;
    case "signature":
      return `<span class="tag tag-signature">Signed by a person</span>`;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function figmaBlock(h: number, inner: string, cls = ""): string {
  const className = cls ? `b ${cls}` : "b";
  return `<div class="${className}" style="height:${h}pt">${inner}</div>`;
}

function fieldInner(item: LayoutFieldRow): string {
  const arabic = item.label.ar
    ? `<p class="fl-ar" dir="rtl">${escapeHtml(item.label.ar)}</p>`
    : "";
  return `<div class="field-label"><p class="fl-en">${escapeHtml(item.label.en)}</p>${arabic}</div><div class="rule">${escapeHtml(item.value)}</div>${sourceTag(item.source)}`;
}

function fieldBlock(layout: EsignDocumentLayout, key: string, h: number): string {
  const item = findRow(layout, key) ?? {
    key,
    label: { en: key, ar: "" },
    value: "",
    source: "entry" as const,
  };
  return figmaBlock(h, fieldInner(item), "field");
}

function sectionBlock(h: number, en: string, ar: string, attrs = ""): string {
  const arabic = ar ? `<span class="sec-ar" dir="rtl">${escapeHtml(ar)}</span>` : "";
  const extra = attrs ? ` ${attrs}` : "";
  return `<div class="b section"${extra} style="height:${h}pt"><span class="sec-en">${escapeHtml(en)}</span>${arabic}</div>`;
}

function checkBlock(h: number, check: LayoutCheckbox, withTag: boolean): string {
  const mark = check.checked ? " on" : "";
  const tag = withTag ? sourceTag("entry") : "";
  const note = check.note?.trim()
    ? `<span class="check-amt">${escapeHtml(check.note.trim())}</span>`
    : "";
  return figmaBlock(
    h,
    `<span class="tick${mark}" data-check-key="${escapeHtml(check.key)}"></span><span class="check-label">${escapeHtml(check.label.en)}</span>${note}${tag}`,
    "checkline",
  );
}

function signLineBlock(h: number, label?: BilingualText): string {
  const text = label ?? { en: "Employee Signature", ar: "توقيع الموظف" };
  return figmaBlock(
    h,
    `<div class="field-label"><p class="fl-en">${escapeHtml(text.en)}</p><p class="fl-ar" dir="rtl">${escapeHtml(text.ar)}</p></div><div class="rule"></div>${sourceTag("signature")}`,
    "field",
  );
}

function authorSignLabel(
  layout: EsignDocumentLayout,
  role: "employee" | "hr" | "gm" | "ceo",
): BilingualText | undefined {
  const rows = layout.sections.find((section) => section.key === "author_signs")?.rows ?? [];
  return rows.find((row) => documentSignRole(row.key, row.label.en) === role)?.label;
}

function managementCaps(layout: EsignDocumentLayout, staffLabel?: string): string {
  const hr = staffCaption(
    staffLabel,
    authorSignLabel(layout, "hr") ?? {
      en: BOTTOM.en.hrAdmin,
      ar: BOTTOM.ar.hrAdmin,
    },
  );
  const gm = authorSignLabel(layout, "gm") ?? {
    en: BOTTOM.en.generalManager,
    ar: BOTTOM.ar.generalManager,
  };
  return `${stackPair(hr.en, hr.ar)}${stackPair(gm.en, gm.ar)}`;
}

function unmatchedSignHtml(layout: EsignDocumentLayout): string {
  const rows = layout.sections.find((section) => section.key === "author_signs")?.rows ?? [];
  return rows
    .filter((row) => {
      const role = documentSignRole(row.key, row.label.en);
      if (!role) return true;
      return !layout.slots.some((slot) => slot.role === role);
    })
    .map(
      (row) =>
        `<div class="payslip-sign" data-author-sign="${escapeHtml(row.key)}"><p class="slot-cap">${pair(row.label)}</p></div>`,
    )
    .join("");
}

function decisionMarks(value: string): { approved: boolean; declined: boolean } {
  const token = value.trim().toLowerCase();
  if (token === "approved" || token === "approve" || token === "yes") {
    return { approved: true, declined: false };
  }
  if (token === "not_approved" || token === "not approved" || token === "rejected" || token === "no") {
    return { approved: false, declined: true };
  }
  return { approved: false, declined: false };
}

function decisionBlock(
  h: number,
  titleEn: string,
  titleAr: string,
  boxLabel: string,
  value: string,
): string {
  const marks = decisionMarks(value);
  const approved = marks.approved ? " on" : "";
  const declined = marks.declined ? " on" : "";
  return figmaBlock(
    h,
    `<div class="dec-copy"><p class="dec-title">${escapeHtml(titleEn)} <span class="dec-ar" dir="rtl">${escapeHtml(titleAr)}</span></p><p class="dec-checks"><span class="tick${approved}"></span> Approved <span class="tick${declined}"></span> Not approved</p></div><div class="dash dec-box"><span>${escapeHtml(boxLabel)}</span></div>`,
    "decision",
  );
}

function ackBlock(h: number, title: string, date: string): string {
  return figmaBlock(
    h,
    `<p class="ack-title">${escapeHtml(title)}</p><div class="ack-gap"></div><div class="ack-row"><div class="dash ack-box"><span>Employee Signature</span></div><span class="ack-date">Date <i class="date-rule">${escapeHtml(date)}</i></span>${sourceTag("signature")}</div>`,
    "ack",
  );
}

function paintPenalty(
  layout: EsignDocumentLayout,
  logoUrl?: string | null,
  staffLabel?: string,
): string[] {
  const checks = layout.sections.find((section) => section.checkboxes)?.checkboxes ?? [];
  const heights = PENALTY_GEOM.map((step) => step.h);
  let index = 0;
  const take = () => heights[index++] ?? 0;
  const blocks = [
    figmaBlock(
      take(),
      `<div class="title-row"><h1 class="title">${escapeHtml(bilingualTitle(layout.title))}</h1>${logoMarkup(logoUrl)}</div>`,
      "title",
    ),
    figmaBlock(take(), "", "divider"),
    sectionBlock(take(), "Employee Information", "بيانات الموظف", 'data-employee-block="1" data-section="employee"'),
    fieldBlock(layout, "employee_name", take()),
    fieldBlock(layout, "employee_number", take()),
    fieldBlock(layout, "position", take()),
    fieldBlock(layout, "company", take()),
    fieldBlock(layout, "accommodation", take()),
    sectionBlock(take(), "Penalty Details", "تفاصيل المخالفة"),
    fieldBlock(layout, "penalty_text", take()),
    fieldBlock(layout, "violation_date", take()),
    sectionBlock(take(), "Penalty", "الجزاء"),
    ...checks
      .slice(0, PENALTY_CHECK_SLOT_COUNT)
      .map((check) => checkBlock(take(), check, check.key === "others")),
    ...Array.from({ length: Math.max(0, PENALTY_CHECK_SLOT_COUNT - checks.length) }, () =>
      figmaBlock(take(), "", "checkline"),
    ),
    fieldBlock(layout, "repeated", take()),
    signLineBlock(take(), authorSignLabel(layout, "employee")),
    sectionBlock(take(), BOTTOM.en.managementUseOnly, BOTTOM.ar.managementUseOnly),
    figmaBlock(take(), `<div class="dash mgmt-box"></div><div class="dash mgmt-box"></div>`, "mgmt-boxes"),
    figmaBlock(take(), managementCaps(layout, staffLabel), "mgmt-caps"),
    figmaBlock(take(), `${sourceTag("signature")}${sourceTag("signature")}`, "mgmt-pills"),
    fieldBlock(layout, "remarks", take()),
    figmaBlock(
      take(),
      `<span class="ref">Form Ref.: MG HR Ref Emp. 0011</span>${logoMarkup(logoUrl)}`,
      "foot",
    ),
  ];
  if (index !== PENALTY_GEOM.length) throw new Error("figma_geom_mismatch");
  return blocks;
}

function paintLoan(
  layout: EsignDocumentLayout,
  logoUrl?: string | null,
  staffLabel?: string,
): string[] {
  const heights = LOAN_GEOM.map((step) => step.h);
  let index = 0;
  const take = () => heights[index++] ?? 0;
  const blocks = [
    figmaBlock(
      take(),
      `<div class="title-row"><h1 class="title">${escapeHtml(bilingualTitle(layout.title))}</h1>${logoMarkup(logoUrl)}</div>`,
      "title",
    ),
    figmaBlock(take(), "", "divider"),
    sectionBlock(take(), "Employee Details", "بيانات الموظف", 'data-employee-block="1" data-section="employee"'),
    fieldBlock(layout, "request_date", take()),
    fieldBlock(layout, "employee_id", take()),
    fieldBlock(layout, "employee_name", take()),
    fieldBlock(layout, "sponsor", take()),
    fieldBlock(layout, "joining", take()),
    fieldBlock(layout, "position", take()),
    sectionBlock(take(), "Loan Details", "تفاصيل السلفة"),
    fieldBlock(layout, "purpose", take()),
    fieldBlock(layout, "amount", take()),
    fieldBlock(layout, "period", take()),
    fieldBlock(layout, "start_month", take()),
    fieldBlock(layout, "ending", take()),
    fieldBlock(layout, "unsettled", take()),
    signLineBlock(take(), authorSignLabel(layout, "employee")),
    sectionBlock(take(), "Approval Status", "حالة الموافقة"),
    decisionBlock(
      take(),
      "HR Decision",
      "قرار الموارد البشرية",
      staffCaption(staffLabel, authorSignLabel(layout, "hr") ?? { en: "HR Signature", ar: "HR Signature" })
        .en,
      findRow(layout, "hr_decision")?.value ?? "",
    ),
    decisionBlock(
      take(),
      "CEO Decision",
      "قرار الرئيس التنفيذي",
      authorSignLabel(layout, "ceo")?.en ?? "CEO Signature",
      findRow(layout, "ceo_decision")?.value ?? "",
    ),
    fieldBlock(layout, "payment", take()),
    fieldBlock(layout, "remarks", take()),
    ackBlock(take(), "In case of receiving the loan", findRow(layout, "ack_received_date")?.value ?? ""),
    ackBlock(take(), "In case of not receiving the loan", findRow(layout, "ack_not_received_date")?.value ?? ""),
  ];
  if (index !== LOAN_GEOM.length) throw new Error("figma_geom_mismatch");
  return blocks;
}

function payslipInner(layout: EsignDocumentLayout): string {
  const sheet = layout.payslip;
  if (!sheet) return "";
  const identity = sheet.identity
    .map(
      (item) =>
        `<div class="payslip-id" data-payslip-key="${escapeHtml(item.key)}"><span class="lbl">${pair(item.label)}</span><span class="val">${escapeHtml(item.value)}</span></div>`,
    )
    .join("");
  const lines = sheet.lines
    .map((line) => {
      const name = line.code
        ? `${escapeHtml(line.code)} — ${pair(line.name)}`
        : pair(line.name);
      const tone = line.tone === "plain" ? "" : ` data-tone="${line.tone}"`;
      return `<tr data-payslip-line="${escapeHtml(line.key)}"${tone}><td>${name}</td><td class="num">${escapeHtml(line.rate)}</td><td class="num">${escapeHtml(line.amount)}</td></tr>`;
    })
    .join("");
  return `<section class="payslip-sheet" data-payslip="sheet"><div class="payslip-identity" data-payslip="identity">${identity}</div><table class="payslip-lines"><thead><tr><th>${pair({ en: "Code / Name", ar: "الرمز / الاسم" })}</th><th>${pair({ en: "Rate", ar: "المعدل" })}</th><th>${pair({ en: "Amount (KD)", ar: "المبلغ (د.ك)" })}</th></tr></thead><tbody>${lines}</tbody></table></section>`;
}

const PAYSLIP_SLOT_CAPTION: Record<"employee" | "hr", BilingualText> = {
  employee: { en: "Employee Sign", ar: "توقيع الموظف" },
  hr: { en: "Management Sign", ar: "توقيع الإدارة" },
};

function payslipRest(
  layout: EsignDocumentLayout,
  staffLabel?: string,
): { flow: string; band: string } {
  const opening = layout.sections.find((section) => section.key === "opening");
  const openingHtml =
    opening?.body && (opening.body.en || opening.body.ar)
      ? `<section class="block" data-section="opening"><h2>${stackPair(opening.title.en, opening.title.ar)}</h2>${stackBody(opening.body)}</section>`
      : "";
  const extra = layout.sections.find((section) => section.key === "payslip_extra");
  const extraHtml = extra
    ? `<section class="block" data-section="payslip_extra"><h2>${stackPair(extra.title.en, extra.title.ar)}</h2>${extra.rows.map(stackKvRow).join("")}</section>`
    : "";
  const declaration =
    layout.declaration.en || layout.declaration.ar
      ? `<section class="block" data-section="declaration"><h2>${stackPair("Declaration", "الإقرار")}</h2><div class="declaration">${stackBody(layout.declaration)}</div></section>`
      : "";
  const signRows = layout.sections.find((section) => section.key === "payslip_signs")?.rows ?? [];
  const captionFor = (role: "employee" | "hr"): BilingualText => {
    const match = signRows.find((row) => payslipSignRole(row.key, row.label.en) === role);
    const fallback = match ? match.label : PAYSLIP_SLOT_CAPTION[role];
    return role === "hr" ? staffCaption(staffLabel, fallback) : fallback;
  };
  const slots = layout.slots
    .map((item) => {
      const box = slotPageBox(item);
      const caption =
        item.role === "employee" || item.role === "hr"
          ? captionFor(item.role)
          : SLOT_CAPTION[item.role];
      return `<div class="slot" data-slot-role="${escapeHtml(item.role)}" style="left:${box.left}pt;top:${box.top}pt;width:${box.width}pt;height:${box.height}pt"><p class="slot-cap">${pair(caption)}</p></div>`;
    })
    .join("");
  const unmatched = signRows
    .filter((row) => payslipSignRole(row.key, row.label.en) == null)
    .map(
      (row) =>
        `<div class="payslip-sign" data-payslip-sign="${escapeHtml(row.key)}"><p class="slot-cap">${pair(row.label)}</p></div>`,
    )
    .join("");
  const band = `<div class="signature-band" data-signature-band="1">${slots}${unmatched}</div>`;
  return { flow: `${openingHtml}${extraHtml}${declaration}`, band };
}

function appendixHtml(layout: EsignDocumentLayout): string {
  const opening = layout.sections.find((section) => section.key === "opening");
  const openingHtml =
    opening?.body && (opening.body.en || opening.body.ar)
      ? `<section class="appendix" data-section="opening"><h2>${stackPair(opening.title.en, opening.title.ar)}</h2>${stackBody(opening.body)}</section>`
      : "";
  const appendix = layout.sections.find((section) => section.key === "appendix");
  const declaration =
    layout.declaration.en || layout.declaration.ar
      ? `<section class="decl appendix" data-section="declaration"><h2>${stackPair("Declaration", "الإقرار")}</h2>${stackBody(layout.declaration)}</section>`
      : "";
  const signs = unmatchedSignHtml(layout);
  if (!appendix) return `${openingHtml}${declaration}${signs}`;
  const rows = appendix.rows.map(stackKvRow).join("");
  const body =
    appendix.body && (appendix.body.en || appendix.body.ar)
      ? stackBody(appendix.body)
      : "";
  return `${openingHtml}<section class="appendix" data-section="appendix"><h2>${stackPair(appendix.title.en, appendix.title.ar)}</h2>${rows}${body}</section>${declaration}${signs}`;
}

function slotLayer(slots: SignSlot[]): string {
  const marks = slots
    .map((item) => {
      const box = slotPageBox(item);
      return `<div class="slot" data-slot-role="${escapeHtml(item.role)}" data-slot-id="${escapeHtml(item.id)}" style="left:${box.left}pt;top:${box.top}pt;width:${box.width}pt;height:${box.height}pt"></div>`;
    })
    .join("");
  return `<div class="signature-band" data-signature-band="1">${marks}</div>`;
}

/** Room above the general / payslip signature line. The line itself stays put. */
const SHEET_BODY_MAX_PT = slotPageBox(GENERAL_SLOTS[0]).top - 28 - 8;

function tailMarkup(layout: EsignDocumentLayout): string {
  const extra = appendixHtml(layout);
  if (!extra.trim()) return "";
  const band = figmaTailBand(layout.kind === "loan" ? LOAN_GEOM : PENALTY_GEOM);
  return `<div class="tail" style="top:${band.top}pt;height:${band.height}pt"><div class="tail-fit">${extra}</div></div>`;
}

function renderFigmaSheet(
  layout: EsignDocumentLayout,
  fontCss?: string,
  logoUrl?: string | null,
  staffLabel?: string,
): string {
  const flow =
    layout.kind === "loan"
      ? paintLoan(layout, logoUrl, staffLabel).join("")
      : paintPenalty(layout, logoUrl, staffLabel).join("");
  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8"/>
<style>
@page { size: A4; margin: 0; }
html, body { margin: 0; padding: 0; width: 595.28pt; height: 841.89pt; overflow: hidden; direction: ltr; background: #fff; }
body { font-family: "Noto Sans", "Noto Sans Arabic", "Segoe UI", Tahoma, sans-serif; color: #18181b; }
${fontCss ?? ""}
.page { position: relative; width: 595.28pt; height: 841.89pt; overflow: hidden; padding: 20pt 24pt 12pt; box-sizing: border-box; }
.b { margin: 0 0 2pt 0; padding: 0; box-sizing: border-box; overflow: hidden; }
.title-row { display: flex; align-items: center; justify-content: space-between; gap: 12pt; height: 100%; }
.title { margin: 0; font-size: 14pt; font-weight: 700; line-height: 18pt; }
.divider { background: #e5e5e5; }
.section { display: flex; align-items: center; justify-content: space-between; }
.sec-en { font-size: 10.5pt; font-weight: 600; }
.sec-ar { font-size: 9pt; color: #a1a1aa; }
.field { display: flex; align-items: center; gap: 8pt; }
.field-label { width: 168pt; flex: 0 0 168pt; }
.fl-en { margin: 0; font-size: 10pt; font-weight: 500; line-height: 1.15; }
.fl-ar, .dec-ar { margin: 0; font-size: 8.5pt; color: #a1a1aa; line-height: 1.15; direction: rtl; unicode-bidi: isolate; }
.rule { width: 180pt; height: 16pt; border-bottom: 0.75pt solid #e5e5e5; font-size: 9pt; line-height: 16pt; overflow: hidden; }
.tag { margin-left: auto; padding: 2pt 8pt; border-radius: 4pt; font-size: 9pt; font-weight: 500; line-height: 1.2; white-space: nowrap; }
.tag-system { background: #eff6ff; color: #2563eb; }
.tag-entry { background: #ecfdf5; color: #059669; }
.tag-fixed { background: #f4f4f5; color: #71717a; }
.tag-signature { background: #f2ecff; color: #6d28d9; }
.checkline { display: flex; align-items: center; gap: 6pt; }
.tick { width: 12pt; height: 12pt; box-sizing: border-box; border: 1.5pt solid #71717a; display: inline-block; flex: 0 0 12pt; }
.tick.on { background: #18181b; border-color: #18181b; }
.check-label { font-size: 10pt; }
.dash { box-sizing: border-box; background: #fafafa; border: 0.75pt dashed #e5e5e5; border-radius: 4pt; }
.mgmt-boxes { display: grid; grid-template-columns: 140pt 140pt; column-gap: 12pt; width: 292pt; }
.mgmt-box { width: 140pt; height: 36pt; box-sizing: border-box; }
.mgmt-caps, .mgmt-pills { display: grid; grid-template-columns: 140pt 140pt; column-gap: 12pt; width: 292pt; color: #71717a; }
.mgmt-caps { font-size: 7pt; line-height: 1; }
.mgmt-caps .stack { width: 140pt; display: flex; flex-direction: column; gap: 0; }
.mgmt-caps .stack-ar { font-size: 6.5pt; color: #a1a1aa; }
.mgmt-pills { font-size: 8pt; }
.mgmt-pills .tag { width: 140pt; box-sizing: border-box; text-align: center; margin: 0; }
.check-amt { margin-inline-start: auto; color: #3f3f46; }
.decision { display: flex; align-items: flex-start; justify-content: space-between; padding-top: 4pt; }
.dec-title { margin: 0; font-size: 10pt; font-weight: 600; }
.dec-checks { margin: 4pt 0 0; font-size: 10pt; display: flex; align-items: center; gap: 6pt; }
.dec-box { width: 120pt; height: 32pt; display: flex; align-items: flex-end; justify-content: center; font-size: 8pt; color: #71717a; }
.ack-title { height: 14pt; margin: 0; font-size: 10pt; font-weight: 600; line-height: 14pt; }
.ack-gap { height: 2pt; }
.ack-row { height: 30pt; display: flex; align-items: center; gap: 8pt; }
.ack-box { width: 130pt; height: 30pt; flex: 0 0 130pt; display: flex; align-items: flex-end; justify-content: center; font-size: 8pt; color: #71717a; }
.ack-date { font-size: 10pt; }
.date-rule { display: inline-block; width: 120pt; border-bottom: 0.75pt solid #e5e5e5; font-style: normal; }
.foot, .sheet-foot { display: flex; align-items: center; justify-content: space-between; gap: 12pt; }
.sheet-foot { position: absolute; left: 24pt; right: 24pt; bottom: 10pt; }
.ref { font-size: 8pt; color: #a1a1aa; }
.logo-img { height: 20pt; width: auto; max-width: 56pt; object-fit: contain; display: block; }
.stack-en, .stack-ar { display: block; }
.decl { margin-top: 6pt; padding-top: 4pt; border-top: 0.5pt solid #e4e4e7; }
.decl p { margin: 2pt 0; }
.signature-band { position: absolute; inset: 0; pointer-events: none; }
.slot { position: absolute; box-sizing: border-box; }
.tail { position: absolute; left: 24pt; right: 24pt; overflow: hidden; background: #fff; }
.tail-fit { font-size: 8pt; line-height: 1.25; }
.appendix { margin-top: 4pt; font-size: 8pt; }
.appendix h2 { font-size: 8pt; margin: 0 0 2pt; }
.kv { display: flex; gap: 8pt; margin: 2pt 0; }
.lbl { color: #71717a; }
.ar { direction: rtl; unicode-bidi: isolate; }
.section-body { white-space: pre-wrap; }
</style>
</head>
<body>
<div class="page" data-single-page="1">
  ${flow}
  ${tailMarkup(layout)}
  ${layout.kind === "loan" ? sheetFootMarkup(logoUrl) : ""}
  ${slotLayer(layout.slots)}
</div>
</body>
</html>`;
}

export function renderLayoutHtml(
  layout: EsignDocumentLayout,
  fontCss?: string,
  logoUrl?: string | null,
  staffLabel?: string,
): string {
  if (layout.kind === "penalty" || layout.kind === "loan") {
    return renderFigmaSheet(layout, fontCss, logoUrl, staffLabel);
  }
  const title = bilingualTitle(layout.title);
  const isPayslip = layout.kind === "payslip" && Boolean(layout.payslip);
  const employeeBlock = layout.employeeRows.map(stackKvRow).join("");
  const sections = layout.sections
    .filter((section) => section.key !== "author_signs")
    .map((section) => {
      const rows = section.rows.map(stackKvRow).join("");
      const checks = (section.checkboxes ?? [])
        .map((check) => {
          const mark = check.checked ? " checked" : "";
          return `<div class="check${mark}" data-check-key="${escapeHtml(check.key)}"><span class="box"></span><span class="lbl">${stackPair(check.label.en, check.label.ar)}</span></div>`;
        })
        .join("");
      const body =
        section.body && (section.body.en || section.body.ar)
          ? `<div class="section-body">${stackBody(section.body)}</div>`
          : "";
      return `<section class="block" data-section="${escapeHtml(section.key)}"><h2>${stackPair(section.title.en, section.title.ar)}</h2>${rows}${checks}${body}</section>`;
    })
    .join("");

  const declaration =
    layout.declaration.en || layout.declaration.ar
      ? `<section class="block" data-section="declaration"><h2>${stackPair("Declaration", "الإقرار")}</h2><div class="declaration">${stackBody(layout.declaration)}</div></section>`
      : "";

  const signRows = layout.sections.find((section) => section.key === "author_signs")?.rows ?? [];
  const slots = layout.slots
    .map((slot) => {
      const match = signRows.find((row) => documentSignRole(row.key, row.label.en) === slot.role);
      return slotMarkup(slot, match?.label, staffLabel);
    })
    .join("");
  const extraSigns = unmatchedSignHtml(layout);
  const payslip = isPayslip ? payslipRest(layout, staffLabel) : null;
  const hrFoot = staffCaption(staffLabel, { en: BOTTOM.en.hrAdmin, ar: BOTTOM.ar.hrAdmin });

  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8"/>
<style>
@page { size: A4; margin: 0; }
html, body { margin: 0; padding: 0; width: 595.28pt; height: 841.89pt; overflow: hidden; direction: ltr; }
body {
  font-family: "Noto Sans", "Noto Sans Arabic", "Segoe UI", Tahoma, sans-serif;
  font-size: 10pt;
  line-height: 1.4;
  color: #1a1d21;
}
${fontCss ?? ""}
.page {
  position: relative;
  width: 595.28pt;
  height: 841.89pt;
  max-height: 841.89pt;
  overflow: hidden;
  padding: 28pt 36pt 16pt;
  box-sizing: border-box;
}
.sheet-body { max-height: ${SHEET_BODY_MAX_PT}pt; overflow: hidden; }
.ar { direction: rtl; unicode-bidi: isolate; }
.masthead { display: flex; justify-content: space-between; align-items: center; border-bottom: 1.5pt solid #1a1d21; padding-bottom: 8pt; margin-bottom: 12pt; }
.mast-brand { display: flex; align-items: center; gap: 8pt; }
.mast-brand .logo-img { height: 22pt; width: auto; max-width: 56pt; object-fit: contain; display: block; }
.masthead .co { font-weight: 700; font-size: 11pt; margin: 0; }
.masthead .meta { font-size: 8pt; color: #5b616b; text-align: end; }
.header { font-size: 14pt; font-weight: 700; margin-bottom: 10pt; }
.employee-block {
  border: 1pt solid #c5c9d0;
  padding: 8pt 10pt;
  margin-bottom: 12pt;
}
.employee-block .kv, .block .kv { display: grid; grid-template-columns: 140pt minmax(0,1fr); column-gap: 12pt; align-items: start; margin: 3pt 0; }
.lbl { color: #5b616b; font-size: 8pt; }
.lbl .stack { display: flex; flex-direction: column; gap: 0; }
.lbl .stack-ar { font-size: 7pt; color: #a1a1aa; }
.val { font-weight: 600; min-width: 0; border-bottom: 0.6pt solid #e4e4e7; padding-bottom: 1pt; }
h2 { font-size: 9.5pt; margin: 10pt 0 5pt; }
.check { display: flex; align-items: center; gap: 6pt; margin: 3pt 0; font-size: 8.5pt; }
.check .box { width: 7pt; height: 7pt; border: 0.6pt solid #4b5563; display: inline-block; }
.check.checked .box { background: #111827; }
.section-body, .declaration { white-space: pre-wrap; font-size: 9pt; }
.slot {
  position: absolute;
  box-sizing: border-box;
  border-top: 0.75pt solid #6b7280;
  padding-top: 2pt;
}
.slot-cap { margin: 0; font-size: 6.5pt; color: #4b5563; font-weight: 600; }
.mgmt {
  position: absolute;
  left: 36pt;
  right: 36pt;
  top: 714pt;
  bottom: 12pt;
  border: 0.5pt solid #c5c9d0;
  font-size: 7pt;
  color: #4b5563;
  box-sizing: border-box;
}
.mgmt-head {
  margin: 0;
  padding: 3pt 8pt;
  background: #f1f2f4;
  border-bottom: 0.5pt solid #c5c9d0;
  font-weight: 700;
}
.mgmt-row { display: grid; grid-template-columns: minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr); gap: 8pt; padding: 5pt 8pt; align-items: start; }
.mgmt-cell { display: flex; flex-direction: column; gap: 1pt; }
.mgmt-box { display: inline-block; width: 6pt; height: 6pt; border: 0.5pt solid #6b7280; margin-inline-end: 2pt; }
.mgmt-signs { display: grid; grid-template-columns: 140pt 140pt; column-gap: 12pt; width: 292pt; padding: 0 8pt 4pt; }
.mgmt-sign { display: flex; flex-direction: column; gap: 2pt; }
.mgmt-sign-box { width: 140pt; height: 22pt; box-sizing: border-box; background: #fafafa; border: 0.75pt dashed #d4d4d8; border-radius: 4pt; }
.sheet-foot { display: flex; align-items: center; justify-content: space-between; gap: 12pt; padding: 3pt 8pt 4pt; border-top: 0.5pt solid #e4e4e7; }
.sheet-foot .ref { font-size: 7pt; color: #a1a1aa; }
.sheet-foot .logo-img, .mast-brand .logo-img { height: 16pt; width: auto; max-width: 56pt; object-fit: contain; display: block; }
.payslip-page-foot { position: absolute; left: 36pt; right: 36pt; bottom: 12pt; display: flex; align-items: center; justify-content: space-between; }
.payslip-identity { border: 1pt solid #c5c9d0; padding: 6pt 8pt; margin-bottom: 10pt; }
.payslip-id { display: flex; gap: 10pt; margin: 3pt 0; }
.payslip-lines { width: 100%; border-collapse: collapse; font-size: 9pt; }
.payslip-lines th, .payslip-lines td { border: 0.6pt solid #c5c9d0; padding: 4pt 6pt; text-align: start; vertical-align: top; }
.payslip-lines th { background: #f4f4f5; font-size: 8pt; }
.payslip-lines .num { text-align: end; font-variant-numeric: tabular-nums; }
.payslip-lines tr[data-tone="days"] .num:last-child { color: #067647; font-weight: 700; }
.payslip-lines tr[data-tone="net"] { background: #ecfdf3; }
.payslip-lines tr[data-tone="net"] .num:last-child { color: #067647; font-weight: 700; }
.payslip-sign { margin-top: 8pt; border-top: 0.75pt solid #6b7280; padding-top: 2pt; min-height: 28pt; }
</style>
</head>
<body>
<div class="page" data-single-page="1">
  <div class="sheet-body"><div class="sheet-body-fit">
  <div class="masthead">
    <div class="mast-brand">
      ${logoMarkup(logoUrl)}
      <p class="co">${escapeHtml(layout.masthead.company)}</p>
    </div>
    <div class="meta">
      <p>${escapeHtml(layout.masthead.ref)}</p>
      <p>${escapeHtml(layout.masthead.date)}</p>
    </div>
  </div>
  <header class="header">${escapeHtml(title)}</header>
  ${
    payslip
      ? `${payslipInner(layout)}${payslip.flow}`
      : `<section class="employee-block" data-employee-block="1">${employeeBlock}</section>
  ${sections}
  ${declaration}`
  }
  </div></div>
  ${
    payslip
      ? `${payslip.band}<div class="payslip-page-foot">${sheetFootMarkup(logoUrl)}</div>`
      : `<div class="signature-band" data-signature-band="1">${slots}${extraSigns}</div>
  <div class="mgmt" data-management="1">
    <p class="mgmt-head">${stackPair(BOTTOM.en.managementUseOnly, BOTTOM.ar.managementUseOnly)}</p>
    <div class="mgmt-row">
      <span class="mgmt-cell">${stackPair(BOTTOM.en.ceoDecision, BOTTOM.ar.ceoDecision)}</span>
      <span class="mgmt-cell"><span><span class="mgmt-box"></span>${stackPair(BOTTOM.en.approved, BOTTOM.ar.approved)}</span></span>
      <span class="mgmt-cell"><span><span class="mgmt-box"></span>${stackPair(BOTTOM.en.notApproved, BOTTOM.ar.notApproved)}</span></span>
    </div>
    <div class="mgmt-signs">
      <div class="mgmt-sign"><div class="mgmt-sign-box"></div>${stackPair(hrFoot.en, hrFoot.ar)}</div>
      <div class="mgmt-sign"><div class="mgmt-sign-box"></div>${stackPair(BOTTOM.en.generalManager, BOTTOM.ar.generalManager)}</div>
    </div>
    ${sheetFootMarkup(logoUrl, `Form Ref.: MG HR Ref Emp. ${layout.masthead.ref}`)}
  </div>`
  }
</div>
</body>
</html>`;
}

/**
 * Shrink only the overflow band (penalty/loan tail, or payslip/general body).
 * Named signature boxes stay at their unscaled coordinates.
 */
export function fitEsignSinglePage(root?: ParentNode): void {
  const scope: ParentNode = root ?? document;
  const fit = (boxSel: string, innerSel: string) => {
    const box = scope.querySelector(boxSel);
    const inner = scope.querySelector(innerSel);
    if (!box || !inner || !("style" in inner) || !("clientHeight" in box) || !("scrollHeight" in inner)) {
      return;
    }
    const boxEl = box as HTMLElement;
    const innerEl = inner as HTMLElement;
    innerEl.style.setProperty("zoom", "1");
    const limit = boxEl.clientHeight;
    const needed = innerEl.scrollHeight;
    if (needed > limit + 1 && limit > 0) {
      innerEl.style.setProperty("zoom", String(limit / needed));
    }
  };
  fit(".tail", ".tail-fit");
  fit(".sheet-body", ".sheet-body-fit");
}

export function sampleEmployee(overrides: Partial<EsignEmployeeSnapshot> = {}): EsignEmployeeSnapshot {
  return {
    company_name: "Musallam Delivery",
    employee_name: "Ahmed Ali",
    employee_id: "10421",
    driver_code: "10021",
    civil_id: "284091200123",
    joined_at: "2024-03-12",
    accommodation: "Hawally camp, block 4",
    zone: "Hawally",
    project: "talabat",
    nationality: "EG",
    ...overrides,
  };
}
