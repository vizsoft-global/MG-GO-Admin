import type { EsignTemplateFieldRow } from "./types";
import { ABSENCE_FROM_KEYS, ABSENCE_TO_KEYS, withAbsenceDateFields } from "./esign-absence-fields";

/**
 * Accident / sick leave / medical report / declaration share one template.
 *
 * The template carries `request_kind`; the kind decides which date pair the
 * sheet prints. Sick leave reuses the absence From/To pair, the other three use
 * Accident date + Report date. Keeping the gate here (rather than in the send
 * screen) means the builder preview, the send form and the PDF all agree.
 */
export const REQUEST_KIND_KEY = "request_kind";

export const ACCIDENT_REQUEST_KINDS = [
  { value: "accident", labelEn: "Accident", labelAr: "حادث" },
  { value: "sick_leave", labelEn: "Sick leave", labelAr: "إجازة مرضية" },
  { value: "medical_report", labelEn: "Medical report", labelAr: "تقرير طبي" },
  { value: "declaration", labelEn: "Declaration", labelAr: "إقرار" },
] as const;

export type AccidentRequestKind = (typeof ACCIDENT_REQUEST_KINDS)[number]["value"];

const KIND_VALUES = new Set<string>(ACCIDENT_REQUEST_KINDS.map((kind) => kind.value));

export function requestedDocumentLines(raw: unknown): string[] {
  const text = typeof raw === "string" ? raw : "";
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const part of text.split(/\r?\n|,/)) {
    const line = part.trim();
    if (!line || seen.has(line.toLowerCase())) continue;
    seen.add(line.toLowerCase());
    lines.push(line);
    if (lines.length === 12) break;
  }
  return lines;
}

export function normalizeAccidentKind(raw: unknown): AccidentRequestKind {
  const value = typeof raw === "string" ? raw.trim() : "";
  return KIND_VALUES.has(value) ? (value as AccidentRequestKind) : "accident";
}

export function accidentKindLabel(kind: unknown): { en: string; ar: string } {
  const normalized = normalizeAccidentKind(kind);
  const row = ACCIDENT_REQUEST_KINDS.find((entry) => entry.value === normalized);
  return { en: row?.labelEn ?? "Accident", ar: row?.labelAr ?? "حادث" };
}

/** A kind is present on a send when the template or the values carries it. */
export function isAccidentRequest(
  values: Record<string, string>,
  fields: readonly { field_key?: string; key?: string }[],
): boolean {
  return (
    (values[REQUEST_KIND_KEY] ?? "").trim() !== "" ||
    fields.some(
      (field) => field.field_key === REQUEST_KIND_KEY || field.key === REQUEST_KIND_KEY,
    )
  );
}

function syntheticAccidentField(
  key: "accident_date" | "report_date",
  templateId: string,
): EsignTemplateFieldRow {
  const accident = key === "accident_date";
  return {
    id: `synthetic-${key}`,
    template_id: templateId,
    field_key: key,
    label_en: accident ? "Accident date" : "Report date",
    label_ar: accident ? "تاريخ الحادث" : "تاريخ التقرير",
    field_type: "date",
    options: [],
    is_required: false,
    sort_order: accident ? 912 : 913,
    source_kind: "entry",
    section_key: "document",
    options_source: null,
    preview_value: null,
  };
}

/**
 * Applies the kind's date pair to a template's fields.
 *
 * Sick leave delegates to `withAbsenceDateFields`; the other kinds add
 * Accident date / Report date when the template does not already carry them.
 */
export function withAccidentFields(
  fields: EsignTemplateFieldRow[],
  templateId: string,
  kind: unknown,
): EsignTemplateFieldRow[] {
  if (normalizeAccidentKind(kind) === "sick_leave") {
    return withAbsenceDateFields(fields, templateId);
  }
  const next = [...fields];
  if (!next.some((field) => field.field_key === "accident_date")) {
    next.push(syntheticAccidentField("accident_date", templateId));
  }
  if (!next.some((field) => field.field_key === "report_date")) {
    next.push(syntheticAccidentField("report_date", templateId));
  }
  return next;
}

/** Keys the accident sheet consumes, so they never reprint in the tail. */
export const ACCIDENT_CONSUMED_KEYS = [
  REQUEST_KIND_KEY,
  "requested_documents",
  "accident_date",
  "report_date",
  ...ABSENCE_FROM_KEYS,
  ...ABSENCE_TO_KEYS,
] as const;
