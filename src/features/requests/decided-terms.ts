import type { RequestApprovalStep, RequestDecisionTerms } from "./types";

const TERM_KEYS = [
  "approved_amount",
  "approved_tenure_months",
  "deduction_start_date",
  "penalty_amount",
  "required_document",
] as const;

function number(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function stepMetaHasDecisionTerms(
  meta: Record<string, unknown> | null | undefined,
): boolean {
  if (!meta) return false;
  return TERM_KEYS.some((key) => meta[key] != null && String(meta[key]).trim() !== "");
}

export function termsFromMeta(meta: Record<string, unknown>): RequestDecisionTerms {
  return {
    approved_amount: number(meta.approved_amount),
    approved_tenure_months: number(meta.approved_tenure_months),
    deduction_start_date:
      meta.deduction_start_date != null ? String(meta.deduction_start_date) : null,
    penalty_amount: number(meta.penalty_amount),
    required_document: meta.required_document != null ? String(meta.required_document) : null,
  };
}

/** Latest completed step that actually stored terms — skip empty later steps. */
export function decidedTerms(steps: RequestApprovalStep[]): RequestDecisionTerms | null {
  const completed = steps
    .filter((step) => step.status === "completed" && stepMetaHasDecisionTerms(step.meta))
    .sort((a, b) => b.step_order - a.step_order)[0];
  if (!completed?.meta) return null;
  return termsFromMeta(completed.meta);
}

export function decidedTermsHaveValues(terms: RequestDecisionTerms | null): boolean {
  if (!terms) return false;
  return (
    terms.approved_amount != null ||
    terms.approved_tenure_months != null ||
    Boolean(terms.deduction_start_date?.trim()) ||
    terms.penalty_amount != null ||
    Boolean(terms.required_document?.trim())
  );
}

/** Keep the last submitted terms on screen until the refetch writes them back. */
export function overlayDecisionTerms(
  server: RequestDecisionTerms | null,
  held: RequestDecisionTerms | null,
): RequestDecisionTerms | null {
  return decidedTermsHaveValues(server) ? server : (held ?? server);
}
