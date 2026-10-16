import {
  buildEsignDocumentLayout,
  type BuildLayoutInput,
  type EsignDocumentLayout,
  type LayoutSource,
} from "./esign-document-layout";
import { type EsignEmployeeSnapshot } from "./esign-placeholders";
import { renderClientSheetHtml } from "./esign-client-sheet";

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
  /** eSign request code (SIG-####). Printed as Document ID. Empty until the request exists. */
  requestCode?: string;
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
    requestCode: input.requestCode,
  } satisfies BuildLayoutInput);
}

export function buildEsignDocumentHtml(input: EsignDocumentInput): string {
  const layout = documentInputToLayout(input);
  return renderLayoutHtml(layout, input.fontCss, input.logoUrl, input.staffLabel);
}

/** Client HR sheet for every kind. logoUrl is accepted and never printed. */
export function renderLayoutHtml(
  layout: EsignDocumentLayout,
  fontCss?: string,
  logoUrl?: string | null,
  staffLabel?: string,
): string {
  void logoUrl;
  return renderClientSheetHtml(layout, fontCss, staffLabel);
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
    const limit = innerEl.clientHeight > 0 ? innerEl.clientHeight : boxEl.clientHeight;
    const needed = innerEl.scrollHeight;
    if (needed > limit + 1 && limit > 0) {
      innerEl.style.setProperty("zoom", String(limit / needed));
    }
  };
  fit(".page", ".page-fit");
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
