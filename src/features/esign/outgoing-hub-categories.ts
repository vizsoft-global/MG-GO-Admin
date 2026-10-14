import { isPenaltyActionFieldKey, penaltyCheckLabels } from "./esign-penalty-checks";
import { isPenaltyChild, PENALTY_SUBCATEGORY_KEYS } from "./esign-penalty-subcategories";

/**
 * Outgoing HUB categories. Library, send, and bulk pickers allowlist these
 * (plus penalty children). Everything else is Draft.
 */
export const OUTGOING_HUB_CATEGORY_KEYS = [
  "loan",
  "payslip",
  "asset",
  "leave",
  "penalty",
  "investigation",
  "accident",
  "general_doc",
] as const;

export type OutgoingHubCategoryKey = (typeof OUTGOING_HUB_CATEGORY_KEYS)[number];

const HUB_SET = new Set<string>(OUTGOING_HUB_CATEGORY_KEYS);

/**
 * Figma seed keys. A leftover V1 `category_key` must not hide or re-home
 * one of these eight.
 */
export const FIGMA_HUB_CATEGORY: Record<string, OutgoingHubCategoryKey> = {
  loan_request: "loan",
  payslip: "payslip",
  asset: "asset",
  leave: "leave",
  penalty_notice: "penalty",
  investigation: "investigation",
  accident: "accident",
  general_document: "general_doc",
};

export const FIGMA_HUB_DOCUMENT_KIND: Record<string, "loan" | "payslip" | "penalty" | "general"> = {
  loan_request: "loan",
  payslip: "payslip",
  asset: "general",
  leave: "general",
  penalty_notice: "penalty",
  investigation: "general",
  accident: "general",
  general_document: "general",
};

const FIGMA_HUB_BY_NAME_EN: Record<string, OutgoingHubCategoryKey> = {
  "Loan Request": "loan",
  Payslip: "payslip",
  Asset: "asset",
  Leave: "leave",
  "Penalty Notice": "penalty",
  Investigation: "investigation",
  Accident: "accident",
  "General document": "general_doc",
};

export type OutgoingHubRow = {
  category_key?: string | null;
  figma_key?: string | null;
  name_en?: string | null;
};

export function figmaHubCategory(row: OutgoingHubRow): OutgoingHubCategoryKey | null {
  const figma = row.figma_key?.trim() ?? "";
  if (figma && FIGMA_HUB_CATEGORY[figma]) return FIGMA_HUB_CATEGORY[figma];
  const name = row.name_en?.trim() ?? "";
  return FIGMA_HUB_BY_NAME_EN[name] ?? null;
}

/** Figma slot wins. Bare `other` stays a penalty child. */
export function effectiveOutgoingCategoryKey(row: OutgoingHubRow): string {
  return figmaHubCategory(row) ?? alignPenaltyCategoryKey(row.category_key ?? "");
}

export type OutgoingHubDraftDecision =
  | { action: "skip" }
  | { action: "draft" }
  | { action: "promote"; category_key: OutgoingHubCategoryKey };

export function outgoingHubDraftDecision(row: OutgoingHubRow & {
  is_active?: boolean;
  is_draft?: boolean;
}): OutgoingHubDraftDecision {
  const hub = figmaHubCategory(row);
  if (hub) {
    const needsPromote =
      row.category_key !== hub || row.is_draft === true || row.is_active === false;
    return needsPromote ? { action: "promote", category_key: hub } : { action: "skip" };
  }
  if (isOutgoingHubCategory(row.category_key ?? "")) return { action: "skip" };
  if (row.is_draft === true && row.is_active === false) return { action: "skip" };
  return { action: "draft" };
}

/** Hub fallback used `other`; the catalogue key is `penalty_others`. */
export function alignPenaltyCategoryKey(key: string): string {
  if (key === "other") return "penalty_others";
  return key;
}

export function isOutgoingHubCategory(
  key: string,
  parentKey?: string | null,
): boolean {
  const aligned = alignPenaltyCategoryKey(key);
  if (HUB_SET.has(aligned)) return true;
  return isPenaltyChild({ key: aligned, parent_key: parentKey ?? "penalty" })
    || (PENALTY_SUBCATEGORY_KEYS as readonly string[]).includes(aligned);
}

export function isPenaltyHubQuery(key: string): boolean {
  const aligned = alignPenaltyCategoryKey(key);
  return aligned === "penalty" || isPenaltyChild({ key: aligned, parent_key: "penalty" });
}

/** Templates shown when the send URL carries `?category=`. */
export function templatesForHubCategory<T extends OutgoingHubRow>(
  rows: readonly T[],
  categoryKey: string,
): T[] {
  const aligned = alignPenaltyCategoryKey(categoryKey);
  if (isPenaltyHubQuery(aligned)) {
    return rows.filter((row) => isPenaltyHubQuery(effectiveOutgoingCategoryKey(row)));
  }
  return rows.filter((row) => effectiveOutgoingCategoryKey(row) === aligned);
}

export function isSendableHubTemplate(row: OutgoingHubRow & {
  category_key: string | null;
  is_active?: boolean;
  is_draft?: boolean;
}): boolean {
  return (
    row.is_active !== false &&
    row.is_draft !== true &&
    isOutgoingHubCategory(effectiveOutgoingCategoryKey(row))
  );
}

/** Exact category first. A parent hub key may fall back to its sendable pool. */
export function pickSendableHubTemplate<
  T extends OutgoingHubRow & {
    category_key?: string | null;
    is_active?: boolean;
    is_draft?: boolean;
  },
>(rows: readonly T[], categoryKey: string): T | null {
  const aligned = alignPenaltyCategoryKey(categoryKey);
  const sendable = rows.filter((row) =>
    isSendableHubTemplate({
      ...row,
      category_key: row.category_key ?? null,
    }),
  );
  const exact = sendable.filter((row) => effectiveOutgoingCategoryKey(row) === aligned);
  if (exact.length > 0) return exact[0] ?? null;
  if (HUB_SET.has(aligned)) {
    const pool = templatesForHubCategory(sendable, aligned);
    return pool[0] ?? null;
  }
  return null;
}

/** Parents plus penalty children — Assign Staff Sender column. */
export const OUTGOING_SENDER_KEYS = [
  ...OUTGOING_HUB_CATEGORY_KEYS,
  ...PENALTY_SUBCATEGORY_KEYS,
] as const;

export function selectOptionsForField(
  field: { field_type: string; field_key?: string; options?: readonly string[] | null },
  categoryKey: string,
): string[] {
  const own = (field.options ?? []).map((value) => value.trim()).filter(Boolean);
  if (own.length) return own;
  if (isPenaltyActionFieldKey(field.field_key ?? "")) return penaltyCheckLabels();
  if (field.field_type === "select" && isPenaltyHubQuery(categoryKey)) {
    return [...PENALTY_SUBCATEGORY_KEYS];
  }
  return [];
}
