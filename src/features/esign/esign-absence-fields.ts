import type { EsignTemplateFieldRow } from "./types";

export const ABSENCE_FROM_KEYS = ["absence_from", "absent_from"] as const;
export const ABSENCE_TO_KEYS = ["absence_to", "absent_to"] as const;

export function hasAbsenceKey(
  fields: readonly { field_key: string }[],
  keys: readonly string[],
): boolean {
  return fields.some((field) => keys.includes(field.field_key));
}

export function syntheticAbsenceField(
  key: "absence_from" | "absence_to",
  templateId: string,
): EsignTemplateFieldRow {
  const from = key === "absence_from";
  return {
    id: `synthetic-${key}`,
    template_id: templateId,
    field_key: key,
    label_en: from ? "Absence from" : "Absence to",
    label_ar: from ? "الغياب من" : "الغياب إلى",
    field_type: "date",
    options: [],
    is_required: false,
    sort_order: from ? 910 : 911,
    source_kind: "entry",
    section_key: "document",
    options_source: null,
    preview_value: null,
  };
}

export function withAbsenceDateFields(
  fields: EsignTemplateFieldRow[],
  templateId: string,
): EsignTemplateFieldRow[] {
  const next = [...fields];
  if (!hasAbsenceKey(fields, ABSENCE_FROM_KEYS)) {
    next.push(syntheticAbsenceField("absence_from", templateId));
  }
  if (!hasAbsenceKey(fields, ABSENCE_TO_KEYS)) {
    next.push(syntheticAbsenceField("absence_to", templateId));
  }
  return next;
}
