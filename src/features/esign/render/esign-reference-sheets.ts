import type {
  EsignDocumentLayout,
  LayoutFieldRow,
  PayslipLine,
} from "./esign-document-layout";
import { escapeHtml } from "./esign-placeholders";
import { MUSALLAM_GROUP_LOGO } from "./esign-reference-logo";

/**
 * Reference sheets for the three forms the client signed off on
 * (`Loan.html`, `Accident.html`, `Payslip.html`).
 *
 * These are deliberately separate from the generic bilingual grid: the
 * reference is a three-column table with a navy title band (loan), a
 * two-column declaration (accident), and a blue payroll voucher (payslip).
 * Reusing the generic grid for them is what made the templates look unchanged.
 */

const shown = (value: string | null | undefined): string => {
  const trimmed = value?.trim() ?? "";
  return trimmed || "—";
};

const ar = (value: string): string =>
  `<span class="ar" dir="rtl">${escapeHtml(value)}</span>`;

function rowValue(layout: EsignDocumentLayout, keys: readonly string[]): string {
  const pools = [layout.employeeRows, ...layout.sections.map((section) => section.rows)];
  for (const rows of pools) {
    for (const row of rows) {
      if (keys.includes(row.key) && row.value.trim() && row.value.trim() !== "—") {
        return row.value.trim();
      }
    }
  }
  return "";
}

/** Payslip identity values live in `payslip_fields`, ahead of the line table. */
function payslipValue(layout: EsignDocumentLayout, keys: readonly string[]): string {
  const fields = layout.sections.find((section) => section.key === "payslip_fields")?.rows ?? [];
  for (const entry of fields) {
    if (keys.includes(entry.key) && entry.value.trim()) return entry.value.trim();
  }
  return rowValue(layout, keys);
}

function rowsOf(layout: EsignDocumentLayout, key: string): LayoutFieldRow[] {
  return layout.sections.find((section) => section.key === key)?.rows ?? [];
}

function tableRows(
  layout: EsignDocumentLayout,
  key: string,
  labels: Record<string, [string, string]>,
): string {
  return rowsOf(layout, key)
    .filter((entry) => labels[entry.key])
    .map((entry) => {
      const [en, arabic] = labels[entry.key];
      const value = entry.value.trim() || "—";
      return `<tr><td class="ref-lab">${escapeHtml(en)}</td><td class="ref-val">${escapeHtml(value)}</td><td class="ref-ar">${ar(arabic)}</td></tr>`;
    })
    .join("");
}

const SHARED_CSS = `
:root {
  --navy: #27283D;
  --loan-label: #DCE3F2;
  --pay-blue: #2A43A6;
  --pay-line: #3552C4;
  --pay-label: #E5EBFF;
  --pay-border: #B9C1D9;
  --pay-muted: #5B627A;
  --pay-orange: #F26A3D;
  --pay-orange-tint: #FFE8DE;
}
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: "Plex", "Noto Sans Arabic", sans-serif;
  color: #000;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.ar { direction: rtl; unicode-bidi: isolate; }
.page { position: relative; width: 210mm; height: 297mm; min-height: 297mm; background: #fff; display: flex; flex-direction: column; overflow: hidden; }
.page-fit { flex: 1; min-height: 0; display: flex; flex-direction: column; }
@media screen { body { background: #E6E8EC; } .page { margin: 10mm auto; box-shadow: 0 2px 14px rgba(0,0,0,.12); } }
@media print {
  .page { margin: 0; box-shadow: none; break-after: page; page-break-after: always; }
  .page:last-child { break-after: auto; page-break-after: auto; }
  .ref-table, .pay-grid, .pay-lines, .ref-decl, .ref-policy, .acc-body, .acc-tail { break-inside: avoid; page-break-inside: avoid; }
}
`;

const LOAN_CSS = `
.loan-page { padding: 18mm 20mm 14mm 22mm; color: #000; font-size: 9pt; }
.loan-toprule { height: 1.1pt; background: var(--navy); margin-bottom: 12mm; }
.loan-bottomrule { position: absolute; left: 22mm; right: 20mm; bottom: 18mm; height: 1.1pt; background: var(--navy); }
.loan-title { background: var(--navy); color: #fff; text-align: center; font-weight: 700; font-size: 12pt; padding: 1.5mm 0; letter-spacing: .2pt; }
.loan-title .ar { color: #fff; font-size: 12.5pt; }
.loan-title .sep { padding: 0 2mm; }
.loan-block { margin-top: 2.2mm; }
.ref-sec { background: var(--loan-label); color: #000; text-align: center; font-weight: 700; font-size: 9pt; border: .6pt solid var(--navy); border-bottom: 0; padding: 1.1mm 0; }
.ref-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.ref-table col.c-lab { width: 38%; }
.ref-table col.c-val { width: 30%; }
.ref-table col.c-ar { width: 32%; }
.ref-table td { border: .6pt solid var(--navy); height: 6mm; padding: 0 2mm; font-size: 9.5pt; vertical-align: middle; }
.ref-table .ref-lab { background: var(--loan-label); text-align: left; }
.ref-table .ref-ar { background: var(--loan-label); text-align: right; font-size: 8.6pt; }
.ref-table .ref-val { text-align: center; font-weight: 400; font-size: 9.5pt; }
.ref-decision { display: flex; align-items: center; justify-content: center; gap: 4mm; white-space: nowrap; }
.ref-table .ref-val.ref-sign-cell { padding: 0 3mm; }
.ref-sig { display: block; width: 100%; height: 5.2mm; border-bottom: .6pt dotted #4A4A4A; }
.ref-decl { border: .6pt solid var(--navy); border-top: 0; padding: 1.6mm 2.2mm; display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; font-size: 7.8pt; line-height: 1.5; }
.ref-decl .ar { text-align: right; font-size: 7pt; }
.ref-policy { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; font-size: 7.8pt; line-height: 1.5; padding: 1.3mm 2mm; border: .6pt solid var(--navy); border-top: 0; }
.ref-policy .ar { text-align: right; font-size: 7pt; }
.ref-policy p { margin: 0 0 1mm; }
.ref-checks { display: inline-flex; align-items: center; gap: 1.5mm; margin-inline-start: 3mm; font-size: 8.5pt; }
.ref-checks:first-child { margin-inline-start: 0; }
.ref-check { display: inline-flex; width: 3.4mm; height: 3.4mm; border: .8pt solid #000; align-items: center; justify-content: center; font-size: 7pt; line-height: 1; }
.ref-check.on::after { content: "\\2713"; }
`;

const ACCIDENT_CSS = `
.acc-page { padding: 12mm 18mm 60mm; font-size: 9.2pt; }
.acc-logo { width: 21mm; height: 21mm; object-fit: contain; display: block; }
.acc-title { display: flex; flex-direction: column; align-items: center; text-align: center; font-weight: 700; font-size: 13.5pt; margin: -10mm 0 10mm; }
.acc-title .ar { display: inline-block; font-size: 12.5pt; border-bottom: 1.2pt solid #000; padding-bottom: .6mm; }
.acc-title .en { display: block; margin-top: 1.4mm; }
.acc-body { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; line-height: 1.85; }
.acc-body .ar { text-align: right; }
.acc-body p { margin: 0 0 5mm; }
.acc-list { margin: 0 0 5mm; padding-left: 7mm; }
.acc-list li { margin-bottom: 2.4mm; }
.acc-ar-list { margin: 0 0 5mm; padding-right: 7mm; list-style: none; }
.acc-ar-list li { margin-bottom: 2.4mm; position: relative; }
.acc-ar-list li::before { content: "\\2022"; position: absolute; right: -4mm; }
.acc-tail { margin-top: auto; padding-top: 20mm; display: flex; flex-direction: column; gap: 10mm; }
.acc-tail-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; align-items: end; }
.acc-tail-row .en { display: flex; align-items: flex-end; gap: 1.5mm; }
.acc-tail-row .ar { display: flex; align-items: flex-end; gap: 1.5mm; justify-content: flex-start; }
.acc-tail-row .dots { display: inline-block; border-bottom: .6pt dotted #000; height: 4.6mm; flex: 1; }
.acc-tail-row i[data-slot-role] { display: inline-block; border-bottom: .6pt dotted #000; height: 4.6mm; flex: 1; }
`;

const PAYSLIP_CSS = `
.pay-page { padding: 14mm 12mm 12mm; color: #1D2340; }
.pay-topline { height: 1.5mm; background: var(--pay-blue); margin: -14mm -12mm 0; }
.pay-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 6mm; padding: 4.5mm 0 3mm; border-bottom: 1.1mm solid var(--pay-orange); }
.pay-head > div:first-child { flex: 1; min-width: 0; }
.pay-title { font-size: 17pt; font-weight: 700; color: var(--pay-blue); line-height: 1.15; }
.pay-title .period { color: var(--pay-orange); }
.pay-sub { font-size: 9pt; color: var(--pay-muted); margin-top: 1.2mm; text-align: left; }
.pay-company { border: .7pt solid var(--pay-line); background: var(--pay-label); padding: 2.6mm 3.5mm; min-width: 62mm; text-align: right; }
.pay-company .en { font-size: 11pt; font-weight: 700; color: var(--pay-blue); }
.pay-company .ar { font-size: 8.4pt; color: var(--pay-line); margin-top: .8mm; }
.pay-grid { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 3.5mm; }
.pay-grid td { border: .55pt solid var(--pay-border); padding: 1.3mm 2mm; height: 7mm; font-size: 8.8pt; vertical-align: middle; }
.pay-grid .lab { background: var(--pay-label); color: var(--pay-line); font-weight: 600; }
.pay-grid .lab .ar { display: block; font-size: 7.2pt; color: var(--pay-line); font-weight: 400; margin-top: .4mm; text-align: left; }
.pay-grid .val { font-weight: 600; color: #1D2340; }
.pay-grid .val .sub { display: block; font-size: 7.4pt; font-weight: 400; color: var(--pay-muted); margin-top: .6mm; }
.pay-subtable { width: 52%; border-collapse: collapse; table-layout: fixed; margin-top: 3mm; }
.pay-subtable td { border: .55pt solid var(--pay-border); padding: 1.6mm 2mm; font-size: 8.8pt; height: 8mm; }
.pay-subtable .lab { background: var(--pay-label); color: var(--pay-line); font-weight: 600; width: 62%; }
.pay-subtable .lab .ar { display: block; font-size: 7.2pt; font-weight: 400; margin-top: .4mm; text-align: left; }
.pay-lines { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 4mm; }
.pay-lines col.c-name { width: 48%; }
.pay-lines col.c-rate { width: 26%; }
.pay-lines col.c-amt { width: 26%; }
.pay-lines th { background: var(--pay-line); color: #fff; font-size: 8.6pt; font-weight: 700; text-align: left; padding: 1.6mm 2mm; border: .55pt solid var(--pay-line); }
.pay-lines th .ar { display: block; font-size: 7.6pt; font-weight: 400; }
.pay-lines th.num, .pay-lines td.num { text-align: right; }
.pay-lines td { border: .55pt solid var(--pay-border); padding: 1.6mm 2mm; font-size: 8.8pt; height: 8.4mm; }
.pay-lines td .ar { display: block; font-size: 7.4pt; color: var(--pay-muted); }
.pay-lines tr.net td { background: var(--pay-orange-tint); color: var(--pay-orange); font-weight: 700; border-color: var(--pay-orange); }
.pay-lines tr.net td .ar { color: var(--pay-orange); }
.pay-lines td.amount-deduct { color: #C8202F; }
.pay-lines td.amount-extra { color: #1F7A55; }
.pay-extra { width: 62%; border-collapse: collapse; table-layout: fixed; margin-top: 3mm; }
.pay-extra td { border: .5pt solid var(--pay-border); padding: 1.2mm 2mm; font-size: 7.8pt; }
.pay-extra .lab { background: var(--pay-label); color: var(--pay-line); font-weight: 600; width: 42%; }
.pay-sponsor { margin-top: 4mm; padding-top: 1.5mm; }
.pay-sponsor .k { font-size: 8pt; font-weight: 700; color: var(--pay-orange); letter-spacing: .4pt; }
.pay-sponsor .en { font-size: 10.5pt; font-weight: 700; color: var(--pay-line); margin-top: 1mm; }
.pay-sponsor .ar { font-size: 8pt; color: var(--pay-line); margin-top: .6mm; }
.pay-decl { background: #FFF6F2; border-left: 1.2mm solid var(--pay-orange); padding: 2.4mm 3mm; margin-top: 4mm; font-size: 7.6pt; line-height: 1.55; color: var(--pay-muted); width: 62%; }
.pay-decl .ar { margin-top: 1.4mm; }
.pay-signs { display: grid; grid-template-columns: 1fr 1fr; gap: 20mm; margin-top: 12mm; }
.pay-signs .line { border-top: .7pt solid var(--pay-line); padding-top: 1.8mm; }
.pay-signs i[data-slot-role] { display: block; height: 11mm; margin-bottom: 1.5mm; }
.pay-signs .label { display: flex; justify-content: space-between; gap: 2mm; font-size: 8.8pt; font-weight: 700; color: var(--pay-line); }
.pay-signs .label .ar { font-weight: 400; }
.pay-bottomline { height: 1.4mm; background: var(--pay-blue); margin: auto -12mm -12mm; }
`;

const LOAN_EMPLOYEE_LABELS: Record<string, [string, string]> = {
  employee_name: ["Employee name", "اسم الموظف"],
  employee_id: ["Employee number", "رقم الموظف"],
  employee_number: ["Employee number", "رقم الموظف"],
  civil_id: ["Civil ID number", "الرقم المدني"],
  company_name: ["Company", "اسم الشركة"],
  department: ["Department", "القسم"],
  position: ["Position", "المهنة"],
  joined_at: ["Date of employment", "تاريخ التعيين"],
  joining: ["Date of employment", "تاريخ التعيين"],
  request_date: ["Application date", "تاريخ الطلب"],
  date_of_request: ["Application date", "تاريخ الطلب"],
};

const LOAN_REQUEST_LABELS: Record<string, [string, string]> = {
  monthly_salary_kwd: ["Monthly salary (KWD)", "الراتب الشهري (د.ك)"],
  amount: ["Amount requested (KWD)", "المبلغ المطلوب (د.ك)"],
  requested_amount_kwd: ["Amount requested (KWD)", "المبلغ المطلوب (د.ك)"],
  installments: ["Installments (months)", "عدد الأقساط"],
  monthly_installment: ["Monthly installment (KWD)", "القسط الشهري (د.ك)"],
  payment_method: ["Payment method", "طريقة الدفع"],
  reason: ["Reason / supporting document", "السبب / المستند المؤيد"],
};

const LOAN_HR_LABELS: Record<string, [string, string]> = {
  years_of_service: ["Years of service", "سنوات الخدمة"],
  max_loan_policy_kwd: ["Maximum loan per policy (KWD)", "الحد الأقصى وفق السياسة"],
  previous_loan_outstanding_kwd: ["Previous loan outstanding (KWD)", "رصيد سلفة سابقة"],
  policy_check: ["Policy check", "نتيجة التحقق"],
  verified_by_date: ["Verified by / date", "تم التحقق بواسطة / التاريخ"],
  verified_by: ["Verified by / date", "تم التحقق بواسطة / التاريخ"],
};

const LOAN_DECLARATION = {
  en: "I confirm the information above is correct. I authorise the company to deduct the installments from my salary and to settle any remaining balance from my final dues if my service ends.",
  ar: "أقرّ بصحة البيانات أعلاه، وأفوّض الشركة بخصم الأقساط من راتبي وتسوية أي رصيد متبقٍّ من مستحقاتي النهائية عند انتهاء خدمتي",
};

const LOAN_POLICY_NOTES = [
  { en: "1. Eligible after 1 complete year of service.", ar: "1. الاستحقاق بعد إتمام سنة خدمة كاملة." },
  { en: "2. Maximum loan = lower of 7.5 days' salary × years, or 12 × 10% of salary.", ar: "2. الحد الأقصى = الأقل من أجر 7.5 يوم × السنوات، أو 12 × 10% من الراتب." },
  { en: "3. Installment ≤ 10% of salary (Art. 60, Law 6/2010), max 12 months.", ar: "3. القسط لا يتجاوز 10% من الراتب (المادة 60)، وبحد أقصى 12 شهراً." },
  { en: "4. Every request is verified by HR first, then approved or rejected by management at its discretion. The decision is final.", ar: "4. يتم التحقق من كل طلب أولاً من الموارد البشرية، ثم تعتمده الإدارة أو ترفضه وفق تقديرها، ويكون القرار نهائياً" },
];

function declarationFor(
  layout: EsignDocumentLayout,
  reference: { en: string; ar: string },
): { en: string; ar: string } {
  const en = layout.declaration.en.trim();
  const arText = layout.declaration.ar.trim();
  const generic =
    /^i acknowledge that the details above/i.test(en) || /acknowledge the deduction of KD/i.test(en);
  return {
    en: en && !generic ? en : reference.en,
    ar: arText && !generic ? arText : reference.ar,
  };
}

export function renderLoanReferenceSheet(
  layout: EsignDocumentLayout,
  fontCss?: string,
): string {
  const title = layout.title;
  const declarationText = declarationFor(layout, LOAN_DECLARATION);
  const decision = rowValue(layout, ["management_decision"]);
  const approved = /approv|مواف/i.test(decision);
  const rejected = /reject|رفض|غير مواف/i.test(decision);

  const employeeRows = tableRows(layout, "employee", LOAN_EMPLOYEE_LABELS);
  const loanRows = tableRows(layout, "loan", LOAN_REQUEST_LABELS);
  const hrRows = tableRows(layout, "hr_verification", LOAN_HR_LABELS);

  const body = `
<div class="loan-toprule"></div>
<div class="loan-title">${escapeHtml(title.en.toUpperCase())}<span class="sep">·</span>${ar(title.ar)}</div>
<section class="loan-block">
  <div class="ref-sec">Employee Information<span class="sep"> · </span>${ar("بيانات الموظف")}</div>
  <table class="ref-table"><colgroup><col class="c-lab"/><col class="c-val"/><col class="c-ar"/></colgroup><tbody>${employeeRows}</tbody></table>
</section>
<section class="loan-block">
  <div class="ref-sec">Loan Request<span class="sep"> · </span>${ar("بيانات السلفة")}</div>
  <table class="ref-table"><colgroup><col class="c-lab"/><col class="c-val"/><col class="c-ar"/></colgroup><tbody>
    ${loanRows}
    <tr><td class="ref-lab">Employee signature</td><td class="ref-val ref-sign-cell"><i class="ref-sig" data-slot-role="employee"></i></td><td class="ref-ar">${ar("توقيع الموظف")}</td></tr>
  </tbody></table>
  <div class="ref-decl"><div>${escapeHtml(declarationText.en)}</div><div class="ar" dir="rtl">${escapeHtml(declarationText.ar)}</div></div>
</section>
<section class="loan-block">
  <div class="ref-sec">HR Verification<span class="sep"> · </span>${ar("التحقق من الموارد البشرية")}</div>
  <table class="ref-table"><colgroup><col class="c-lab"/><col class="c-val"/><col class="c-ar"/></colgroup><tbody>${hrRows}</tbody></table>
</section>
<section class="loan-block">
  <div class="ref-sec">Management Decision<span class="sep"> · </span>${ar("قرار الإدارة")}</div>
  <table class="ref-table"><colgroup><col class="c-lab"/><col class="c-val"/><col class="c-ar"/></colgroup><tbody>
    <tr><td class="ref-lab">HR Manager</td><td class="ref-val"><div class="ref-decision">
      <span class="ref-checks"><span class="ref-check${approved ? " on" : ""}"></span>Approved</span>
      <span class="ref-checks"><span class="ref-check${rejected ? " on" : ""}"></span>Rejected</span>
    </div></td><td class="ref-ar">${ar("مدير الموارد البشرية")}</td></tr>
    <tr><td class="ref-lab">Management signature</td><td class="ref-val ref-sign-cell"><i class="ref-sig" data-slot-role="hr"></i></td><td class="ref-ar">${ar("توقيع الإدارة")}</td></tr>
  </tbody></table>
  <div class="ref-policy">
    <div>${LOAN_POLICY_NOTES.map((note) => `<p>${escapeHtml(note.en)}</p>`).join("")}</div>
    <div class="ar" dir="rtl">${LOAN_POLICY_NOTES.map((note) => `<p>${escapeHtml(note.ar)}</p>`).join("")}</div>
  </div>
</section>
<div class="loan-bottomrule"></div>`;

  return pageShell("loan", "loan-page", body, fontCss, LOAN_CSS);
}

export function renderAccidentReferenceSheet(
  layout: EsignDocumentLayout,
  fontCss?: string,
): string {
  const rider = layout.riderName?.trim() || rowValue(layout, ["rider_name", "employee_name"]) || "";

  const bulletsEn = [
    "Police traffic report, if available.",
    "Initial medical report.",
    "Sick leave forms.",
    "Medical expenses.",
    "Submit work resume report from the hospital.",
  ];
  const bulletsAr = [
    "تقرير شرطة مروري، إن وجد.",
    "تقرير طبي أولي.",
    "نماذج الإجازات المرضية.",
    "فواتير المصاريف الطبية.",
    "تقرير إثبات العودة إلى العمل من المستشفى.",
  ];

  const body = `
<img class="acc-logo" src="${MUSALLAM_GROUP_LOGO}" alt="Musallam Group"/>
<div class="acc-title"><span class="ar" dir="rtl">إقرار</span><span class="en">Declaration</span></div>
<div class="acc-body">
  <div>
    <p>I declare, the undersigned rider, hereby acknowledge my commitment to submitting all essential documents to complete the accident procedures with the insurance company, which include:</p>
    <ul class="acc-list">${bulletsEn.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    <p>In the event of didn't continue with submitting the documents mentioned, all the medical expenses from the date of the accident will be charged on me.</p>
  </div>
  <div class="ar" dir="rtl">
    <p>أقر أنا المذكور أعلاه، بصفتي السائق الموقع أدناه، بالتزامي بتقديم جميع المستندات الأساسية لإكمال إجراءات الحادث مع شركة التأمين، وهي:</p>
    <ul class="acc-ar-list">${bulletsAr.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    <p>وفي حال عدم استكمال المستندات المذكورة أعلاه، سيتم تحميل جميع المصاريف الطبية منذ بداية الحادث عليّ.</p>
  </div>
</div>
<div class="acc-tail">
  <div class="acc-tail-row">
    <div class="en"><span>Rider Name:</span><span class="dots">${rider ? escapeHtml(rider) : ""}</span></div>
    <div class="ar" dir="rtl"><span>الاسم:</span><span class="dots"></span></div>
  </div>
  <div class="acc-tail-row">
    <div class="en"><span>Signature:</span><i data-slot-role="employee"></i></div>
    <div class="ar" dir="rtl"><span>التوقيع:</span><span class="dots"></span></div>
  </div>
</div>`;

  return pageShell("general", "acc-page", body, fontCss, ACCIDENT_CSS);
}

const AR_MONTHS: Record<string, string> = {
  January: "يناير",
  February: "فبراير",
  March: "مارس",
  April: "أبريل",
  May: "مايو",
  June: "يونيو",
  July: "يوليو",
  August: "أغسطس",
  September: "سبتمبر",
  October: "أكتوبر",
  November: "نوفمبر",
  December: "ديسمبر",
};

function arabicPeriod(period: string): string {
  let out = period;
  for (const [en, arName] of Object.entries(AR_MONTHS)) {
    out = out.replace(new RegExp(en, "gi"), arName);
  }
  return out;
}

const PAYSLIP_DECLARATION = {
  en: "I, the undersigned, confirm that I have read and understood this payslip, including any deductions or additional amounts shown above, that I have received the amounts stated in full, and that I am satisfied with them.",
  ar: "أقر أنا الموقع أدناه بأنني اطلعت على هذا الكشف وفهمت محتوياته، بما في ذلك أي خصومات أو مبالغ إضافية مذكورة أعلاه، وأنني استلمت المبالغ المذكورة كاملة وأنا راضٍ عنها.",
};

function payslipLineRow(line: PayslipLine): string {
  const tone = line.tone === "net" ? "net" : "";
  const amountClass =
    line.key === "deduction_amount_kwd"
      ? "amount-deduct"
      : line.key === "extra_input_kwd"
        ? "amount-extra"
        : "";
  return `<tr class="${tone}"><td>${escapeHtml(line.name.en)}<span class="ar" dir="rtl">${escapeHtml(line.name.ar)}</span></td><td class="num">${escapeHtml(line.rate)}</td><td class="num ${amountClass}">${escapeHtml(line.amount)}</td></tr>`;
}

export function renderPayslipReferenceSheet(
  layout: EsignDocumentLayout,
  fontCss?: string,
): string {
  const company = payslipValue(layout, ["company_name"]) || layout.masthead.company;
  const companyAr = payslipValue(layout, ["company_name_ar"]) || company;
  const name = payslipValue(layout, ["employee_name"]);
  const position = payslipValue(layout, ["position"]);
  const civilId = payslipValue(layout, ["civil_id"]);
  const employeeId = payslipValue(layout, ["employee_id", "employee_number"]);
  const payThrough = payslipValue(layout, ["pay_through"]);
  const bankNumber = payslipValue(layout, ["bank_number"]);
  const dateFrom = payslipValue(layout, ["date_from", "period_from"]);
  const dateTo = payslipValue(layout, ["date_to", "period_to"]);
  const computedOn = payslipValue(layout, ["computed_on"]);
  const fixedDays = payslipValue(layout, ["fixed_working_days", "fixed_days"]);
  const basicSalaryRaw = payslipValue(layout, ["basic_salary", "basic_salary_kwd"]);
  const basicSalary =
    basicSalaryRaw && basicSalaryRaw !== "—" && !/kd/i.test(basicSalaryRaw)
      ? Number.isFinite(Number(basicSalaryRaw.replace(/[^\d.-]/g, "")))
        ? `${Number(basicSalaryRaw.replace(/[^\d.-]/g, "")).toFixed(2)} KD`
        : basicSalaryRaw
      : basicSalaryRaw;
  const month = payslipValue(layout, ["slip_month"]);
  const period = month || [dateFrom, dateTo].filter((value) => value && value !== "—").join(" — ");
  const declarationText = declarationFor(layout, PAYSLIP_DECLARATION);
  const lines = layout.payslip?.lines ?? [];
  const extras = layout.sections.find((section) => section.key === "payslip_extra")?.rows ?? [];

  const label = (en: string, arabic: string) =>
    `<td class="lab">${escapeHtml(en)}<span class="ar" dir="rtl">${escapeHtml(arabic)}</span></td>`;

  const body = `
<div class="pay-topline"></div>
<header class="pay-head">
  <div>
    <div class="pay-title">Salary Slip${period ? `<span class="period"> — ${escapeHtml(period)}</span>` : ""}</div>
    <div class="pay-sub ar" dir="rtl">كشف الراتب${period ? ` — ${escapeHtml(arabicPeriod(period))}` : ""}</div>
  </div>
  <div class="pay-company">
    <div class="en">${escapeHtml(shown(company))}</div>
    <div class="ar" dir="rtl">${escapeHtml(shown(companyAr))}</div>
  </div>
</header>
<table class="pay-grid"><colgroup><col style="width:20%"/><col style="width:30%"/><col style="width:20%"/><col style="width:30%"/></colgroup><tbody>
  <tr>${label("Company", "الشركة")}<td class="val" colspan="3">${escapeHtml(shown(company))}<span class="ar sub" dir="rtl">${escapeHtml(shown(companyAr))}</span></td></tr>
  <tr>${label("Name", "الاسم")}<td class="val">${escapeHtml(shown(name))}</td>${label("Position", "الوظيفة")}<td class="val">${escapeHtml(shown(position))}</td></tr>
  <tr>${label("Civil ID", "الرقم المدني")}<td class="val">${escapeHtml(shown(civilId))}</td>${label("Employee ID", "رقم الموظف")}<td class="val">${escapeHtml(shown(employeeId))}</td></tr>
  <tr>${label("Pay Through", "طريقة الدفع")}<td class="val">${escapeHtml(shown(payThrough))}</td>${label("Bank Number", "رقم البنك")}<td class="val">${escapeHtml(shown(bankNumber))}</td></tr>
  <tr>${label("Date From", "من تاريخ")}<td class="val">${escapeHtml(shown(dateFrom))}</td>${label("Date To", "إلى تاريخ")}<td class="val">${escapeHtml(shown(dateTo))}</td></tr>
  <tr>${label("Computed On", "تاريخ الاحتساب")}<td class="val" colspan="3">${escapeHtml(shown(computedOn))}</td></tr>
</tbody></table>
<table class="pay-subtable"><tbody>
  <tr>${label("Fixed Monthly Working Days", "أيام العمل الشهرية")}<td>${escapeHtml(shown(fixedDays))}</td></tr>
  <tr>${label("Basic Salary", "الراتب الأساسي")}<td>${escapeHtml(shown(basicSalary))}</td></tr>
</tbody></table>
<table class="pay-lines">
  <colgroup><col class="c-name"/><col class="c-rate"/><col class="c-amt"/></colgroup>
  <thead><tr><th>Name<span class="ar" dir="rtl">البيان</span></th><th class="num">Quantity / rate<span class="ar" dir="rtl">الكمية / المعدل</span></th><th class="num">Amount<span class="ar" dir="rtl">المبلغ</span></th></tr></thead>
  <tbody>${lines.map(payslipLineRow).join("")}</tbody>
</table>
${extras.length > 0 ? `<table class="pay-extra"><tbody>${extras.map((entry) => `<tr>${label(entry.label.en, entry.label.ar)}<td>${escapeHtml(entry.value)}</td></tr>`).join("")}</tbody></table>` : ""}
<div class="pay-sponsor">
  <div class="k">SPONSOR / <span class="ar" dir="rtl">الكفيل</span></div>
  <div class="en">${escapeHtml(shown(company))}</div>
  <div class="ar" dir="rtl">${escapeHtml(shown(companyAr))}</div>
</div>
<div class="pay-decl"><div>${escapeHtml(declarationText.en)}</div><div class="ar" dir="rtl">${escapeHtml(declarationText.ar)}</div></div>
<div class="pay-signs">
  <div><i data-slot-role="employee"></i><div class="line label"><span>Employee signature</span>${ar("توقيع الموظف")}</div></div>
  <div><i data-slot-role="hr"></i><div class="line label"><span>Authorized signature</span>${ar("المفوض بالتوقيع")}</div></div>
</div>
<div class="pay-bottomline"></div>`;

  return pageShell("payslip", "pay-page", body, fontCss, PAYSLIP_CSS);
}

function pageShell(
  kind: string,
  pageClass: string,
  body: string,
  fontCss: string | undefined,
  extraCss: string,
): string {
  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8"/>
<style>
${fontCss ?? ""}
${SHARED_CSS}
${extraCss}
</style>
</head>
<body>
<div class="page ${pageClass}" data-single-page="1" data-kind="${escapeHtml(kind)}">
<div class="page-fit">
${body}
</div>
</div>
</body>
</html>`;
}


