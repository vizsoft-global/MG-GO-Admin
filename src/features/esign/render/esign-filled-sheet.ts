import {
  defaultPenaltyActionOptions,
  isPenaltyActionFieldKey,
  PENALTY_VISIBLE_FIELD_KEY,
} from "../esign-penalty-checks";
import { buildEsignDocumentHtml, type EsignDocumentInput } from "./esign-document-html";
import type { LayoutSource } from "./esign-document-layout";
import type { EsignEmployeeSnapshot } from "./esign-placeholders";

export type FilledSheetField = {
  field_key: string;
  label_en: string;
  label_ar: string | null;
  section_key: string;
  source_kind: string;
  options?: readonly string[] | null;
};

export type FilledSheetTemplate = {
  document_kind: unknown;
  header_en: string;
  header_ar: string;
  body_en: string;
  body_ar: string;
  declaration_en: string;
  declaration_ar: string;
  fields: FilledSheetField[];
};

export type FilledSheetInput = {
  template: FilledSheetTemplate;
  snapshot: EsignEmployeeSnapshot;
  fieldValues: Record<string, string>;
  description: string;
  logoUrl?: string | null;
  /** SIG-####. Empty on a preview, before the request exists. */
  requestCode?: string;
};

function layoutSource(value: string): LayoutSource {
  if (value === "system" || value === "entry" || value === "fixed" || value === "signature") {
    return value;
  }
  return "entry";
}

function layoutSection(value: string): "employee" | "document" {
  return value === "employee" ? "employee" : "document";
}

/** The same filled sheet `renderEsignPdf` prints. Stored on the request so a later template edit cannot change it. */
export function filledEsignDocumentInput(input: FilledSheetInput): EsignDocumentInput {
  const { template, snapshot, fieldValues, description, logoUrl } = input;
  const fields = template.fields.map((field) => ({
    key: field.field_key,
    label: field.label_en,
    labelEn: field.label_en,
    labelAr: field.label_ar || field.label_en,
    value: fieldValues[field.field_key] ?? "",
    section: layoutSection(field.section_key),
    source: layoutSource(field.source_kind),
    ...(isPenaltyActionFieldKey(field.field_key)
      ? { options: defaultPenaltyActionOptions(field) }
      : {}),
  }));
  const visible = fieldValues[PENALTY_VISIBLE_FIELD_KEY]?.trim();
  if (visible) {
    fields.push({
      key: PENALTY_VISIBLE_FIELD_KEY,
      label: "",
      labelEn: "",
      labelAr: "",
      value: visible,
      section: "document",
      source: "entry",
    });
  }
  const absenceSpecs: Array<{
    key: string;
    aliases: readonly string[];
    en: string;
    ar: string;
  }> = [
    { key: "absence_from", aliases: ["from_date", "absent_from"], en: "From", ar: "من" },
    { key: "absence_to", aliases: ["to_date", "absent_to"], en: "To", ar: "إلى" },
  ];
  for (const spec of absenceSpecs) {
    const value =
      fieldValues[spec.key]?.trim() ||
      spec.aliases.map((alias) => fieldValues[alias]?.trim()).find(Boolean) ||
      "";
    if (!value || fields.some((field) => field.key === spec.key || spec.aliases.includes(field.key))) {
      continue;
    }
    fields.push({
      key: spec.key,
      label: spec.en,
      labelEn: spec.en,
      labelAr: spec.ar,
      value,
      section: "document",
      source: "entry",
    });
  }

  // Accident templates add these date rows at send time, not in the template.
  // Without them the filled sheet loses the values and drops the whole
  // Request Details section, even though the request stored both dates.
  const accidentSpecs = [
    { key: "accident_date", en: "Accident date", ar: "تاريخ الحادث" },
    { key: "report_date", en: "Report date", ar: "تاريخ التقرير" },
  ] as const;
  for (const spec of accidentSpecs) {
    const value = fieldValues[spec.key]?.trim() ?? "";
    if (!value || fields.some((field) => field.key === spec.key)) continue;
    fields.push({
      key: spec.key,
      label: spec.en,
      labelEn: spec.en,
      labelAr: spec.ar,
      value,
      section: "document",
      source: "entry",
    });
  }
  return {
    language: "en",
    kind: template.document_kind,
    headerEn: template.header_en,
    headerAr: template.header_ar,
    bodyEn: template.body_en,
    bodyAr: template.body_ar,
    declarationEn: template.declaration_en,
    declarationAr: template.declaration_ar,
    header: template.header_en,
    body: template.body_en,
    declaration: template.declaration_en,
    description,
    fields,
    employee: snapshot,
    logoUrl,
    requestCode: input.requestCode,
  };
}

export function filledEsignSheetHtml(input: FilledSheetInput): string {
  return buildEsignDocumentHtml(filledEsignDocumentInput(input));
}

export function snapshotFromStored(value: unknown): EsignEmployeeSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!row.employee_id && !row.employee_name) return null;
  return {
    company_name: String(row.company_name ?? ""),
    employee_name: String(row.employee_name ?? ""),
    employee_id: String(row.employee_id ?? ""),
    driver_code: String(row.driver_code ?? ""),
    civil_id: row.civil_id != null ? String(row.civil_id) : null,
    joined_at: row.joined_at != null ? String(row.joined_at) : null,
    accommodation: row.accommodation != null ? String(row.accommodation) : null,
    zone: row.zone != null ? String(row.zone) : null,
    project: row.project != null ? String(row.project) : null,
    nationality: row.nationality != null ? String(row.nationality) : null,
    position: row.position != null ? String(row.position) : null,
    sponsor: row.sponsor != null ? String(row.sponsor) : null,
    pay_through: row.pay_through != null ? String(row.pay_through) : null,
    bank_number: row.bank_number != null ? String(row.bank_number) : null,
  };
}
