import type { EsignTemplateFieldRow } from "./types";
import {
  snapshotValues,
  type EsignEmployeeSnapshot,
} from "./render/esign-placeholders";

/**
 * How a sheet's editable rows are sectioned on screen.
 *
 * The loan sheet prints three blocks — the request, HR's verification and the
 * management decision — and a flat list of twenty inputs hides that structure
 * from the operator filling them in. The split is derived from the field keys
 * rather than from `section_key`, because every one of them renders in the same
 * document block; it is the *paper* that has three sections.
 */
const LOAN_HR_KEYS = new Set([
  "years_of_service",
  "max_loan_policy_kwd",
  "previous_loan_outstanding_kwd",
  "policy_check",
  "verified_by",
  "verified_date",
]);

const LOAN_MANAGEMENT_KEYS = new Set([
  "hr_manager_name",
  "hr_manager_position",
  "management_decision",
  "amount_received",
]);

const PAYSLIP_VERIFICATION_KEYS = new Set([
  "hr_manager_name",
  "hr_manager_position",
  "computed_by",
]);

export type SheetGroupKey =
  | "loanRequest"
  | "hrVerification"
  | "management"
  | "verification"
  | "fields";

const SHEET_GROUP_ORDER: SheetGroupKey[] = [
  "fields",
  "loanRequest",
  "hrVerification",
  "management",
  "verification",
];

export type SheetFieldGroup = {
  key: SheetGroupKey;
  fields: EsignTemplateFieldRow[];
};

function sheetGroupKey(
  field: EsignTemplateFieldRow,
  kind: string | null,
): SheetGroupKey {
  if (kind === "payslip") {
    return PAYSLIP_VERIFICATION_KEYS.has(field.field_key)
      ? "verification"
      : "fields";
  }
  if (kind !== "loan") return "fields";
  if (LOAN_HR_KEYS.has(field.field_key)) return "hrVerification";
  if (LOAN_MANAGEMENT_KEYS.has(field.field_key)) return "management";
  return "loanRequest";
}

/** Groups the rows in print order, dropping a section that has no rows. */
export function groupSheetFields(
  fields: EsignTemplateFieldRow[],
  kind: string | null,
): SheetFieldGroup[] {
  const groups = new Map<SheetGroupKey, EsignTemplateFieldRow[]>();
  for (const field of fields) {
    const key = sheetGroupKey(field, kind);
    const list = groups.get(key) ?? [];
    list.push(field);
    groups.set(key, list);
  }
  return SHEET_GROUP_ORDER.filter((key) => groups.has(key)).map((key) => ({
    key,
    fields: groups.get(key) ?? [],
  }));
}

/** A blank cell reads as an em-dash rather than as a missing row. */
export function shown(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  return trimmed || "—";
}

/**
 * Every value on the sheet is Admin-controlled. A `system` field arrives
 * pre-filled from the rider's snapshot and a `fixed` field from the template,
 * but both stay editable here; only a `signature` field is not an input,
 * because its value is the rider's ink, not text. Hiding a system row was the
 * reason HR could not correct a salary or a policy figure before sending.
 */
export function isSheetInput(field: EsignTemplateFieldRow): boolean {
  switch (field.source_kind) {
    case "system":
    case "entry":
    case "fixed":
      return true;
    case "signature":
      return false;
    default: {
      const exhaustive: never = field.source_kind;
      return exhaustive;
    }
  }
}

/**
 * What the live preview prints: the rider's snapshot, then anything the
 * operator has typed, then the template's own sample for the rows still blank.
 */
export function previewFieldValues(
  fields: EsignTemplateFieldRow[],
  values: Record<string, string>,
  snapshot: EsignEmployeeSnapshot | null,
): Record<string, string> {
  const next: Record<string, string> = snapshot ? snapshotValues(snapshot) : {};
  for (const field of fields) {
    const typed = values[field.field_key]?.trim();
    if (typed) next[field.field_key] = typed;
    else if (field.preview_value?.trim()) {
      next[field.field_key] = field.preview_value;
    }
  }
  return next;
}
