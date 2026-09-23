import {
  type EsignEmployeeSnapshot,
  escapeHtml,
  fillPlaceholders,
  snapshotValues,
} from "./esign-placeholders";

export const SIGNATURE_BAND_PT = 140;

export type EsignRenderLanguage = "en" | "ar";

export type EsignRenderField = {
  key: string;
  label: string;
  value: string;
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

const EMPLOYEE_LABELS: Record<
  EsignRenderLanguage,
  Record<keyof EsignEmployeeSnapshot, string>
> = {
  en: {
    company_name: "Company",
    employee_name: "Employee name",
    employee_id: "Employee ID",
    driver_code: "Driver ID",
    zone: "Zone",
    project: "Project",
    nationality: "Nationality",
  },
  ar: {
    company_name: "الشركة",
    employee_name: "اسم الموظف",
    employee_id: "رقم الموظف",
    driver_code: "رقم السائق",
    zone: "المنطقة",
    project: "المشروع",
    nationality: "الجنسية",
  },
};

const SECTION = {
  en: { details: "Details", declaration: "Declaration" },
  ar: { details: "التفاصيل", declaration: "الإقرار" },
} as const;

function row(label: string, value: string): string {
  return `<div class="kv"><span class="lbl">${label}</span><span class="val">${value || "—"}</span></div>`;
}

export function buildEsignDocumentHtml(input: EsignDocumentInput): string {
  const dir = input.language === "ar" ? "rtl" : "ltr";
  const labels = EMPLOYEE_LABELS[input.language];
  const values = snapshotValues(input.employee);
  const merged: Record<string, string> = { ...values };
  for (const field of input.fields) {
    merged[field.key] = field.value;
  }

  const header = fillPlaceholders(input.header, merged);
  const body = fillPlaceholders(input.body, merged);
  const declaration = fillPlaceholders(input.declaration, merged);
  const description = fillPlaceholders(input.description, merged);

  const employeeBlock = [
    row(labels.company_name, values.company_name),
    row(labels.employee_name, values.employee_name),
    row(labels.employee_id, values.employee_id),
  ].join("");

  const extra =
    values.driver_code || values.zone || values.project || values.nationality
      ? [
          values.driver_code ? row(labels.driver_code, values.driver_code) : "",
          values.zone ? row(labels.zone, values.zone) : "",
          values.project ? row(labels.project, values.project) : "",
          values.nationality ? row(labels.nationality, values.nationality) : "",
        ].join("")
      : "";

  const fieldRows = input.fields
    .map((field) => row(escapeHtml(field.label), escapeHtml(field.value)))
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
.signature-band {
  break-inside: avoid;
  height: ${SIGNATURE_BAND_PT}pt;
  margin-block-start: 16pt;
}
</style>
</head>
<body>
  <section class="employee-block" data-employee-block="1">${employeeBlock}${extra}</section>
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
  <div class="signature-band" data-signature-band="1"></div>
</body>
</html>`;
}

export function sampleEmployee(overrides: Partial<EsignEmployeeSnapshot> = {}): EsignEmployeeSnapshot {
  return {
    company_name: "Musallam Delivery",
    employee_name: "Ahmed Ali",
    employee_id: "10421",
    driver_code: "10021",
    zone: "Hawally",
    project: "talabat",
    nationality: "EG",
    ...overrides,
  };
}
