import type { LayoutCheckbox, LayoutFieldInput } from "./render/esign-document-layout";

/**
 * Figma `5931:4010` checkbox list. English only on the sheet; Arabic stays
 * empty so a filled option does not grow a second line the frame does not draw.
 * `deduct_1_day`…`deduct_5_day` replace the old combined `deduct_1_5` row.
 */
export const PENALTY_CHECKS: LayoutCheckbox[] = [
  { key: "written_warning", label: { en: "Written warning", ar: "" }, checked: false },
  { key: "deduct_10", label: { en: "10% deduction of a day's salary", ar: "" }, checked: false },
  { key: "deduct_25", label: { en: "25% deduction of a day's salary", ar: "" }, checked: false },
  { key: "deduct_50", label: { en: "50% deduction of a day's salary", ar: "" }, checked: false },
  { key: "deduct_1_day", label: { en: "One day deduction", ar: "" }, checked: false },
  { key: "deduct_2_day", label: { en: "Two days deduction", ar: "" }, checked: false },
  { key: "deduct_3_day", label: { en: "Three days deduction", ar: "" }, checked: false },
  { key: "deduct_4_day", label: { en: "Four days deduction", ar: "" }, checked: false },
  { key: "deduct_5_day", label: { en: "Five days deduction", ar: "" }, checked: false },
  { key: "dismissal_warning", label: { en: "Dismissal final warning", ar: "" }, checked: false },
  { key: "others", label: { en: "Others", ar: "" }, checked: false },
];

export const PENALTY_CHECK_SLOT_COUNT = PENALTY_CHECKS.length;

export const PENALTY_ACTION_FIELD_KEYS = ["penalty_action", "penalty_type"] as const;

/** Stored on the request so send / draft / bulk / PDF share one visible set. */
export const PENALTY_VISIBLE_FIELD_KEY = "penalty_visible";

/** `penalty_visible` when the operator hid every option. Empty string means unset. */
export const PENALTY_VISIBLE_NONE = "__none__";

export function isPenaltyActionFieldKey(key: string): boolean {
  return (PENALTY_ACTION_FIELD_KEYS as readonly string[]).includes(key);
}

export function penaltyCheckLabels(): string[] {
  return PENALTY_CHECKS.map((check) => check.label.en);
}

export function slugPenaltyCheck(label: string): string {
  const trimmed = label.trim();
  const existing = matchPenaltyCheck(trimmed);
  if (existing) return existing.key;
  return trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "custom";
}

export function matchPenaltyCheck(token: string): LayoutCheckbox | undefined {
  const lower = token.trim().toLowerCase();
  if (!lower) return undefined;
  return PENALTY_CHECKS.find(
    (check) => check.key === lower || check.label.en.toLowerCase() === lower,
  );
}

export function isCheckedToken(value: string): boolean {
  const token = value.trim().toLowerCase();
  return token === "1" || token === "true" || token === "yes" || token === "checked" || token === "on";
}

export function parsePenaltyVisible(value: string | null | undefined): string[] | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (trimmed === PENALTY_VISIBLE_NONE) return [];
  return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
}

export function serializePenaltyVisible(keys: readonly string[]): string {
  if (keys.length === 0) return PENALTY_VISIBLE_NONE;
  return keys.join(",");
}

type CheckFieldInput = {
  key: string;
  options?: readonly string[] | null;
  value?: string;
};

function checkboxFromOption(option: string): LayoutCheckbox {
  const existing = matchPenaltyCheck(option);
  if (existing) return { ...existing, checked: false };
  return { key: slugPenaltyCheck(option), label: { en: option.trim(), ar: "" }, checked: false };
}

/**
 * The printed Penalty list. Author options on `penalty_action` win; otherwise
 * any per-key fields; otherwise the Figma eleven. `penalty_visible` / hidden
 * keys then drop rows the operator hid for this send.
 */
export function resolvePenaltyCheckCatalogue(input: {
  fields?: readonly CheckFieldInput[];
  visibleKeys?: readonly string[] | null;
  hiddenKeys?: readonly string[] | null;
}): LayoutCheckbox[] {
  const fields = input.fields ?? [];
  const action = fields.find((field) => isPenaltyActionFieldKey(field.key));
  const fromOptions = (action?.options ?? []).map((item) => item.trim()).filter(Boolean);

  let catalogue: LayoutCheckbox[];
  if (fromOptions.length) {
    catalogue = fromOptions.map(checkboxFromOption);
  } else {
    const keyed = PENALTY_CHECKS.filter((check) => fields.some((field) => field.key === check.key));
    catalogue = keyed.length
      ? keyed.map((check) => ({ ...check, checked: false }))
      : PENALTY_CHECKS.map((check) => ({ ...check, checked: false }));
  }

  const allow = input.visibleKeys
    ? new Set(input.visibleKeys)
    : input.hiddenKeys
      ? null
      : null;
  if (allow) catalogue = catalogue.filter((check) => allow.has(check.key));
  if (input.hiddenKeys?.length) {
    const hide = new Set(input.hiddenKeys);
    catalogue = catalogue.filter((check) => !hide.has(check.key));
  }
  return catalogue;
}

export function parsePenaltyActionTokens(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function serializePenaltyAction(labels: readonly string[]): string {
  return labels.map((item) => item.trim()).filter(Boolean).join(", ");
}

function tokenMatchesCheck(token: string, check: LayoutCheckbox): boolean {
  const lower = token.trim().toLowerCase();
  if (!lower) return false;
  return lower === check.key || lower === check.label.en.toLowerCase();
}

export function isPenaltyCheckSelected(
  check: LayoutCheckbox,
  fields: readonly LayoutFieldInput[],
  actionValue: string,
): boolean {
  if (parsePenaltyActionTokens(actionValue).some((token) => tokenMatchesCheck(token, check))) {
    return true;
  }
  return fields.some((field) => {
    const value = field.value.trim();
    const lower = value.toLowerCase();
    if (field.key === check.key && isCheckedToken(value)) return true;
    if (field.key === check.key && (lower === check.key || lower === check.label.en.toLowerCase())) {
      return true;
    }
    if (isPenaltyActionFieldKey(field.key)) return false;
    if (lower === check.key) return true;
    if (check.label.en && lower === check.label.en.toLowerCase()) return true;
    return false;
  });
}

export function selectedKeysFromPenaltyValues(
  catalogue: readonly LayoutCheckbox[],
  values: Record<string, string>,
): string[] {
  const tokens = parsePenaltyActionTokens(values.penalty_action ?? values.penalty_type ?? "");
  return catalogue
    .filter((check) => {
      if (tokens.some((token) => tokenMatchesCheck(token, check))) return true;
      return isCheckedToken(values[check.key] ?? "");
    })
    .map((check) => check.key);
}

export function checksFromPenaltyFields(fields: readonly LayoutFieldInput[]): LayoutCheckbox[] {
  const visible = parsePenaltyVisible(
    fields.find((field) => field.key === PENALTY_VISIBLE_FIELD_KEY)?.value,
  );
  const catalogue = resolvePenaltyCheckCatalogue({ fields, visibleKeys: visible });
  const actionValue =
    fields.find((field) => isPenaltyActionFieldKey(field.key))?.value.trim() ?? "";
  return catalogue.map((check) => ({
    ...check,
    checked: isPenaltyCheckSelected(check, fields, actionValue),
  }));
}

export function defaultPenaltyActionOptions(
  field: { field_key?: string; options?: readonly string[] | null } | null | undefined,
): string[] {
  const own = (field?.options ?? []).map((item) => item.trim()).filter(Boolean);
  if (own.length) return own;
  if (field && isPenaltyActionFieldKey(field.field_key ?? "")) return penaltyCheckLabels();
  return [];
}

/** Send / draft / bulk values for the printed Penalty checklist. */
export function penaltyControlFieldValues(
  catalogue: readonly LayoutCheckbox[],
  selectedKeys: readonly string[],
  hiddenKeys: readonly string[],
): Record<string, string> {
  const selected = new Set(selectedKeys);
  const visible = catalogue.filter((check) => !hiddenKeys.includes(check.key));
  const labels = visible
    .filter((check) => selected.has(check.key))
    .map((check) => check.label.en);
  const joined = serializePenaltyAction(labels);
  const next: Record<string, string> = {
    [PENALTY_VISIBLE_FIELD_KEY]: serializePenaltyVisible(visible.map((check) => check.key)),
    penalty_action: joined,
    penalty_type: joined,
  };
  for (const check of catalogue) {
    next[check.key] = selected.has(check.key) ? "checked" : "";
  }
  return next;
}
