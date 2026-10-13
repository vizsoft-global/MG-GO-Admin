import {
  bilingualTitle,
  buildEsignDocumentLayout,
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
import {
  type EsignEmployeeSnapshot,
  escapeHtml,
} from "./esign-placeholders";

export const SIGNATURE_BAND_PT = 140;

export type EsignRenderLanguage = "en" | "ar";

export type EsignRenderField = {
  key: string;
  label: string;
  labelEn?: string;
  labelAr?: string;
  value: string;
  section?: "employee" | "document";
  source?: LayoutSource;
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

function slotMarkup(slot: SignSlot, caption?: BilingualText): string {
  const box = slotPageBox(slot);
  const text = caption ?? SLOT_CAPTION[slot.role];
  return `<div class="slot" data-slot-role="${escapeHtml(slot.role)}" style="left:${box.left}pt;top:${box.top}pt;width:${box.width}pt;height:${box.height}pt"><p class="slot-cap">${pair(text)}</p></div>`;
}

export function buildEsignDocumentHtml(input: EsignDocumentInput): string {
  const layout = documentInputToLayout(input);
  return renderLayoutHtml(layout, input.fontCss);
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
  return figmaBlock(
    h,
    `<span class="tick${mark}" data-check-key="${escapeHtml(check.key)}"></span><span class="check-label">${escapeHtml(check.label.en)}</span>${tag}`,
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

function managementCaps(layout: EsignDocumentLayout): string {
  const hr = authorSignLabel(layout, "hr");
  const gm = authorSignLabel(layout, "gm");
  const hrText = hr ? pair(hr) : "HR / Admin Department";
  const gmText = gm ? pair(gm) : "General Manager";
  return `<span>${hrText}</span><span>${gmText}</span>`;
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

function paintPenalty(layout: EsignDocumentLayout): string[] {
  const checks = layout.sections.find((section) => section.checkboxes)?.checkboxes ?? [];
  const heights = PENALTY_GEOM.map((step) => step.h);
  let index = 0;
  const take = () => heights[index++] ?? 0;
  const blocks = [
    figmaBlock(take(), `<h1 class="title">${escapeHtml(bilingualTitle(layout.title))}</h1>`, "title"),
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
    ...checks.map((check) => checkBlock(take(), check, check.key === "others")),
    fieldBlock(layout, "repeated", take()),
    signLineBlock(take(), authorSignLabel(layout, "employee")),
    sectionBlock(take(), "Management Use Only", ""),
    figmaBlock(take(), `<div class="dash mgmt-box"></div><div class="dash mgmt-box"></div>`, "mgmt-boxes"),
    figmaBlock(take(), managementCaps(layout), "mgmt-caps"),
    figmaBlock(take(), `${sourceTag("signature")}${sourceTag("signature")}`, "mgmt-pills"),
    fieldBlock(layout, "remarks", take()),
    figmaBlock(
      take(),
      `<span class="ref">Form Ref.: MG HR Ref Emp. 0011</span><span class="logo">Logo</span>`,
      "foot",
    ),
  ];
  if (index !== PENALTY_GEOM.length) throw new Error("figma_geom_mismatch");
  return blocks;
}

function paintLoan(layout: EsignDocumentLayout): string[] {
  const heights = LOAN_GEOM.map((step) => step.h);
  let index = 0;
  const take = () => heights[index++] ?? 0;
  const blocks = [
    figmaBlock(take(), `<h1 class="title">${escapeHtml(bilingualTitle(layout.title))}</h1>`, "title"),
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
      authorSignLabel(layout, "hr")?.en ?? "HR Signature",
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

function payslipRest(layout: EsignDocumentLayout): string {
  const opening = layout.sections.find((section) => section.key === "opening");
  const openingHtml =
    opening?.body && (opening.body.en || opening.body.ar)
      ? `<section class="block" data-section="opening"><h2>${pair(opening.title)}</h2><div class="section-body">${pair(opening.body)}</div></section>`
      : "";
  const extra = layout.sections.find((section) => section.key === "payslip_extra");
  const extraHtml = extra
    ? `<section class="block" data-section="payslip_extra"><h2>${pair(extra.title)}</h2>${extra.rows.map(kvRow).join("")}</section>`
    : "";
  const declaration =
    layout.declaration.en || layout.declaration.ar
      ? `<section class="block" data-section="declaration"><h2>${pair({ en: "Declaration", ar: "الإقرار" })}</h2><div class="declaration">${pair(layout.declaration)}</div></section>`
      : "";
  const signRows = layout.sections.find((section) => section.key === "payslip_signs")?.rows ?? [];
  const captionFor = (role: "employee" | "hr"): BilingualText => {
    const match = signRows.find((row) => payslipSignRole(row.key, row.label.en) === role);
    return match ? match.label : PAYSLIP_SLOT_CAPTION[role];
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
  return `${openingHtml}${extraHtml}${declaration}<div class="signature-band" data-signature-band="1">${slots}${unmatched}</div>`;
}

function appendixHtml(layout: EsignDocumentLayout): string {
  const opening = layout.sections.find((section) => section.key === "opening");
  const openingHtml =
    opening?.body && (opening.body.en || opening.body.ar)
      ? `<section class="appendix" data-section="opening"><h2>${pair(opening.title)}</h2><div class="section-body">${pair(opening.body)}</div></section>`
      : "";
  const appendix = layout.sections.find((section) => section.key === "appendix");
  const declaration =
    layout.declaration.en || layout.declaration.ar
      ? `<section class="appendix" data-section="declaration"><h2>${pair({ en: "Declaration", ar: "الإقرار" })}</h2><div class="section-body">${pair(layout.declaration)}</div></section>`
      : "";
  const signs = unmatchedSignHtml(layout);
  if (!appendix) return `${openingHtml}${declaration}${signs}`;
  const rows = appendix.rows
    .map(
      (item) =>
        `<div class="kv"><span class="lbl">${pair(item.label)}</span><span class="val">${escapeHtml(item.value) || "—"}</span></div>`,
    )
    .join("");
  const body =
    appendix.body && (appendix.body.en || appendix.body.ar)
      ? `<div class="section-body">${pair(appendix.body)}</div>`
      : "";
  return `${openingHtml}<section class="appendix" data-section="appendix"><h2>${pair(appendix.title)}</h2>${rows}${body}</section>${declaration}${signs}`;
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

function renderFigmaSheet(layout: EsignDocumentLayout, fontCss?: string): string {
  const flow = layout.kind === "loan" ? paintLoan(layout).join("") : paintPenalty(layout).join("");
  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8"/>
<style>
@page { size: A4; margin: 0; }
html, body { margin: 0; padding: 0; direction: ltr; background: #fff; }
body { font-family: "Noto Sans", "Noto Sans Arabic", "Segoe UI", Tahoma, sans-serif; color: #18181b; }
${fontCss ?? ""}
.page { position: relative; width: 595.28pt; min-height: 841.89pt; padding: 20pt 24pt 12pt; box-sizing: border-box; }
.b { margin: 0 0 2pt 0; padding: 0; box-sizing: border-box; overflow: hidden; }
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
.mgmt-boxes { display: flex; gap: 12pt; }
.mgmt-box { width: 140pt; height: 36pt; }
.mgmt-caps, .mgmt-pills { display: flex; gap: 12pt; font-size: 8pt; color: #71717a; }
.mgmt-caps span, .mgmt-pills .tag { width: 140pt; }
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
.foot { display: flex; align-items: center; justify-content: space-between; }
.ref { font-size: 8pt; color: #a1a1aa; }
.logo { width: 32pt; height: 20pt; background: #f5f5f5; color: #a1a1aa; font-size: 8pt; display: flex; align-items: center; justify-content: center; }
.signature-band { position: absolute; inset: 0; pointer-events: none; }
.slot { position: absolute; box-sizing: border-box; }
.appendix { margin-top: 8pt; font-size: 9pt; }
.appendix h2 { font-size: 9pt; margin: 0 0 4pt; }
.kv { display: flex; gap: 8pt; margin: 2pt 0; }
.lbl { color: #71717a; }
.ar { direction: rtl; unicode-bidi: isolate; }
.section-body { white-space: pre-wrap; }
</style>
</head>
<body>
<div class="page">
  ${flow}
  ${appendixHtml(layout)}
  ${slotLayer(layout.slots)}
</div>
</body>
</html>`;
}

export function renderLayoutHtml(layout: EsignDocumentLayout, fontCss?: string): string {
  if (layout.kind === "penalty" || layout.kind === "loan") {
    return renderFigmaSheet(layout, fontCss);
  }
  const title = bilingualTitle(layout.title);
  const isPayslip = layout.kind === "payslip" && Boolean(layout.payslip);
  const employeeBlock = layout.employeeRows.map(kvRow).join("");
  const sections = layout.sections
    .filter((section) => section.key !== "author_signs")
    .map((section) => {
      const rows = section.rows.map(kvRow).join("");
      const checks = (section.checkboxes ?? [])
        .map((check) => {
          const mark = check.checked ? " checked" : "";
          return `<div class="check${mark}" data-check-key="${escapeHtml(check.key)}"><span class="box"></span><span class="lbl">${pair(check.label)}</span></div>`;
        })
        .join("");
      const body =
        section.body && (section.body.en || section.body.ar)
          ? `<div class="section-body">${pair(section.body)}</div>`
          : "";
      return `<section class="block" data-section="${escapeHtml(section.key)}"><h2>${pair(section.title)}</h2>${rows}${checks}${body}</section>`;
    })
    .join("");

  const declaration =
    layout.declaration.en || layout.declaration.ar
      ? `<section class="block" data-section="declaration"><h2>${pair({ en: "Declaration", ar: "الإقرار" })}</h2><div class="declaration">${pair(layout.declaration)}</div></section>`
      : "";

  const signRows = layout.sections.find((section) => section.key === "author_signs")?.rows ?? [];
  const slots = layout.slots
    .map((slot) => {
      const match = signRows.find((row) => documentSignRole(row.key, row.label.en) === slot.role);
      return slotMarkup(slot, match?.label);
    })
    .join("");
  const extraSigns = unmatchedSignHtml(layout);

  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8"/>
<style>
@page { size: A4; margin: 0; }
html, body { margin: 0; padding: 0; direction: ltr; }
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
  min-height: 841.89pt;
  padding: 28pt 36pt 210pt;
  box-sizing: border-box;
}
.ar { direction: rtl; unicode-bidi: isolate; }
.masthead { display: flex; justify-content: space-between; border-bottom: 1.5pt solid #1a1d21; padding-bottom: 8pt; margin-bottom: 12pt; }
.masthead .co { font-weight: 700; font-size: 11pt; }
.masthead .meta { font-size: 8pt; color: #5b616b; text-align: end; }
.header { font-size: 14pt; font-weight: 700; margin-bottom: 10pt; }
.employee-block {
  border: 1pt solid #c5c9d0;
  padding: 8pt 10pt;
  margin-bottom: 12pt;
}
.employee-block .kv, .block .kv { display: flex; gap: 10pt; margin: 2.5pt 0; }
.lbl { flex: 0 0 14rem; color: #5b616b; font-size: 8pt; }
.val { font-weight: 600; }
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
  bottom: 28pt;
  border: 0.5pt solid #c5c9d0;
  font-size: 7pt;
  color: #4b5563;
}
.mgmt-head {
  margin: 0;
  padding: 2pt 4pt;
  background: #f1f2f4;
  border-bottom: 0.5pt solid #c5c9d0;
  font-weight: 700;
  text-transform: uppercase;
}
.mgmt-row { display: flex; gap: 8pt; padding: 3pt 4pt; align-items: center; }
.mgmt-box { display: inline-block; width: 6pt; height: 6pt; border: 0.5pt solid #6b7280; margin-inline-end: 2pt; }
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
<div class="page">
  <div class="masthead">
    <div>
      <p class="co">${escapeHtml(layout.masthead.company)}</p>
    </div>
    <div class="meta">
      <p>${escapeHtml(layout.masthead.ref)}</p>
      <p>${escapeHtml(layout.masthead.date)}</p>
    </div>
  </div>
  <header class="header">${escapeHtml(title)}</header>
  ${
    isPayslip
      ? `${payslipInner(layout)}${payslipRest(layout)}`
      : `<section class="employee-block" data-employee-block="1">${employeeBlock}</section>
  ${sections}
  ${declaration}
  <div class="signature-band" data-signature-band="1">${slots}${extraSigns}</div>
  <div class="mgmt" data-management="1">
    <p class="mgmt-head">${pair({ en: BOTTOM.en.managementUseOnly, ar: BOTTOM.ar.managementUseOnly })}</p>
    <div class="mgmt-row">
      <span>${pair({ en: BOTTOM.en.ceoDecision, ar: BOTTOM.ar.ceoDecision })}</span>
      <span><span class="mgmt-box"></span>${pair({ en: BOTTOM.en.approved, ar: BOTTOM.ar.approved })}</span>
      <span><span class="mgmt-box"></span>${pair({ en: BOTTOM.en.notApproved, ar: BOTTOM.ar.notApproved })}</span>
    </div>
  </div>`
  }
</div>
</body>
</html>`;
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
