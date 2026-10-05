import {
  type EsignEmployeeSnapshot,
  escapeHtml,
  fillPlaceholders,
  snapshotValues,
} from "./esign-placeholders";
import {
  ESIGN_EMPLOYEE_CORE_ROWS,
  ESIGN_EMPLOYEE_ROWS,
  employeeRowLabel,
} from "../employee-block";

export const SIGNATURE_BAND_PT = 140;

export type EsignRenderLanguage = "en" | "ar";

export type EsignRenderField = {
  key: string;
  label: string;
  value: string;
  /**
   * Which half of the page the row belongs to. `employee` rows print inside the
   * employee block, `document` rows under the Details heading — the same split
   * the builder's two tabs and the live preview use, so a row the author put in
   * the employee tab cannot land in a different place on the delivered PDF.
   */
  section?: "employee" | "document";
};

export type EsignDocumentInput = {
  language: EsignRenderLanguage;
  header: string;
  body: string;
  declaration: string;
  description: string;
  fields: EsignRenderField[];
  employee: EsignEmployeeSnapshot;
  fontCss?: string;
};

const SECTION = {
  en: { details: "Details", declaration: "Declaration" },
  ar: { details: "التفاصيل", declaration: "الإقرار" },
} as const;

/**
 * The bottom skeleton — the two sign-off lines and the Management Use Only box.
 *
 * These are the same regions the live preview draws, and they are the
 * renderer's rather than the author's: a template must not be able to remove
 * the place where the company records its own decision.
 *
 * Exported so the builder's live preview can be **held to these words**. The two
 * surfaces cannot share one string source — the preview is React in the
 * operator's UI locale, this is HTML in the document's own locale — so what they
 * share instead is the contract that for a given language the words are
 * identical. They had already drifted: the preview read "Employee signature"
 * and "Date" while the document a rider received read "Employee Authorized
 * signature" and "Signature and date", and nothing in the build could see it
 * because both are perfectly valid strings. `signature-band-labels.test.ts`
 * now compares every one of these against `messages/{en,ar}.json`.
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

/** The renderer's own view of the band. Kept as an alias so the body below reads unchanged. */
const BOTTOM = ESIGN_BOTTOM_LABELS;

function kvRow(label: string, value: string): string {
  return `<div class="kv"><span class="lbl">${label}</span><span class="val">${value || "—"}</span></div>`;
}

export function buildEsignDocumentHtml(input: EsignDocumentInput): string {
  const dir = input.language === "ar" ? "rtl" : "ltr";
  const values = snapshotValues(input.employee);
  const merged: Record<string, string> = { ...values };
  for (const field of input.fields) {
    merged[field.key] = field.value;
  }

  const header = fillPlaceholders(input.header, merged);
  const body = fillPlaceholders(input.body, merged);
  const declaration = fillPlaceholders(input.declaration, merged);
  const description = fillPlaceholders(input.description, merged);

  // The block is the skeleton's, not the author's: the first three rows always
  // print, and the rest print only when the rider record actually carries them.
  // A rider with no civil ID must not get "Civil ID —" on a signed document.
  const coreRows = ESIGN_EMPLOYEE_CORE_ROWS.map((entry) =>
    kvRow(employeeRowLabel(entry, input.language), values[entry.key] ?? ""),
  ).join("");
  const extraRows = ESIGN_EMPLOYEE_ROWS.slice(ESIGN_EMPLOYEE_CORE_ROWS.length)
    .filter((entry) => (values[entry.key] ?? "").trim().length > 0)
    .map((entry) => kvRow(employeeRowLabel(entry, input.language), values[entry.key] ?? ""))
    .join("");

  // An authored row placed in the employee tab prints *here*, not under Details.
  // Otherwise the preview and the delivered PDF would disagree about a row the
  // author deliberately moved, which is exactly the drift this catalogue exists
  // to prevent.
  const authoredEmployeeRows = input.fields
    .filter((field) => field.section === "employee")
    .map((field) => kvRow(escapeHtml(field.label), escapeHtml(field.value)))
    .join("");

  const employeeBlock = coreRows + extraRows + authoredEmployeeRows;

  const bottom = BOTTOM[input.language];
  const signatureRow = `
    <div class="sig-row">
      <div class="sig-cell">
        <p class="sig-line">${bottom.employeeSignature}</p>
        <p class="sig-hint">${bottom.signatureDate}</p>
      </div>
      <div class="sig-cell">
        <p class="sig-line">${bottom.staffSignature}</p>
        <p class="sig-hint">${bottom.signatureDate}</p>
      </div>
    </div>`;
  const managementBox = `
    <div class="mgmt">
      <p class="mgmt-head">${bottom.managementUseOnly}</p>
      <div class="mgmt-row">
        <span class="mgmt-strong">${bottom.ceoDecision}</span>
        <span class="mgmt-opt"><span class="mgmt-box"></span>${bottom.approved}</span>
        <span class="mgmt-opt"><span class="mgmt-box"></span>${bottom.notApproved}</span>
      </div>
      <div class="mgmt-sign">
        <span class="mgmt-line">${bottom.hrAdmin}</span>
        <span class="mgmt-line">${bottom.generalManager}</span>
      </div>
      <div class="mgmt-sign">
        <span class="mgmt-dot">${bottom.approvalStatus}</span>
        <span class="mgmt-dot">${bottom.decision}</span>
      </div>
    </div>`;

  const fieldRows = input.fields
    .filter((field) => field.section !== "employee")
    .map((field) => kvRow(escapeHtml(field.label), escapeHtml(field.value)))
    .join("");

  return `<!DOCTYPE html>
<html lang="${input.language}" dir="${dir}">
<head>
<meta charset="utf-8"/>
<style>
@page { size: A4; margin: 36pt 36pt 36pt 36pt; }
html, body { margin: 0; padding: 0; }
body {
  font-family: "Noto Sans", "Noto Sans Arabic", "Segoe UI", Tahoma, sans-serif;
  font-size: 11pt;
  line-height: 1.45;
  color: #1a1d21;
}
${input.fontCss ?? ""}
.employee-block {
  border: 1pt solid #c5c9d0;
  padding: 10pt 12pt;
  margin-block-end: 14pt;
}
.employee-block .kv { display: flex; gap: 12pt; margin-block: 3pt; }
.employee-block .lbl { flex: 0 0 9rem; color: #5b616b; font-size: 9pt; }
.employee-block .val { font-weight: 600; }
.header { font-size: 16pt; font-weight: 700; margin-block-end: 10pt; text-align: start; }
.body { white-space: pre-wrap; text-align: start; margin-block-end: 12pt; }
.description { margin-block-end: 12pt; text-align: start; }
.fields { margin-block-end: 12pt; }
.fields .kv { display: flex; gap: 12pt; margin-block: 3pt; }
.fields .lbl { flex: 0 0 9rem; color: #5b616b; font-size: 9pt; }
.fields .val { text-align: start; }
h2 { font-size: 11pt; margin: 12pt 0 6pt; text-align: start; }
.declaration { text-align: start; white-space: pre-wrap; }
/* The bottom skeleton lives *inside* the reserved band rather than above it, so
   filling it in costs no flow height and a document that fitted on one page
   still does. The band is capped at 56% of the text column because the signed
   copy has the rider's signature composited into the bottom-right of the last
   page at absolute coordinates (see esign-compose-stamp.ts): anything drawn in
   that region would be printed under the signature. */
.signature-band {
  break-inside: avoid;
  height: ${SIGNATURE_BAND_PT}pt;
  max-width: 56%;
  margin-block-start: 16pt;
  font-size: 7.5pt;
  color: #4b5563;
}
.sig-row { display: flex; gap: 14pt; }
.sig-cell { flex: 1 1 0; }
.sig-line {
  margin: 0;
  border-top: 0.75pt solid #6b7280;
  padding-block-start: 3pt;
  font-weight: 600;
  color: #374151;
}
.sig-hint { margin: 1pt 0 0; font-size: 6.5pt; color: #9ca3af; }
.mgmt { margin-block-start: 8pt; border: 0.5pt solid #c5c9d0; }
.mgmt-head {
  margin: 0;
  padding: 2pt 4pt;
  background: #f1f2f4;
  border-block-end: 0.5pt solid #c5c9d0;
  font-size: 6.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: #4b5563;
}
.mgmt-row {
  display: flex;
  gap: 8pt;
  align-items: center;
  padding: 3pt 4pt;
  font-size: 7.5pt;
}
.mgmt-strong { font-weight: 700; color: #1f2937; }
.mgmt-opt { display: inline-flex; align-items: center; gap: 2.5pt; }
.mgmt-box {
  display: inline-block;
  inline-size: 6pt;
  block-size: 6pt;
  border: 0.5pt solid #6b7280;
}
.mgmt-sign {
  display: flex;
  gap: 10pt;
  padding: 3pt 4pt;
  border-block-start: 0.5pt dashed #c5c9d0;
}
.mgmt-line {
  flex: 1 1 0;
  border-block-start: 0.5pt solid #6b7280;
  padding-block-start: 2pt;
  font-size: 6.5pt;
}
.mgmt-dot { flex: 1 1 0; font-size: 6.5pt; }
</style>
</head>
<body>
  <section class="employee-block" data-employee-block="1">${employeeBlock}</section>
  ${header ? `<header class="header">${header}</header>` : ""}
  ${description ? `<p class="description">${description}</p>` : ""}
  ${body ? `<div class="body">${body}</div>` : ""}
  ${
    fieldRows
      ? `<section class="fields"><h2>${SECTION[input.language].details}</h2>${fieldRows}</section>`
      : ""
  }
  ${
    declaration
      ? `<section><h2>${SECTION[input.language].declaration}</h2><div class="declaration">${declaration}</div></section>`
      : ""
  }
  <div class="signature-band" data-signature-band="1">${signatureRow}${managementBox}</div>
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
