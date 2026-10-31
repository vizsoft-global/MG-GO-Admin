/**
 * The day-cell vocabulary a payroll adjustment carries.
 *
 * The panel's picker (`src/features/payroll/payroll-rules-engine.ts`
 * `ADJUSTMENT_STATUSES`) is the source of truth: the grid, the rules engine and
 * the day legend all key off those words, so the write path must accept exactly
 * the same list. The SOP's short codes (`abs`, `act`, `alh`, `alo`, `cus`) are
 * kept as aliases because an older row can still carry one, and the function
 * stores the canonical word either way.
 */
export const ADJUSTMENT_STATUSES = [
  "auto",
  "12",
  "3h",
  "half",
  "actual",
  "off",
  "absent",
  "abs_lh",
  "abs_lo",
  "sick",
  "accident",
  "vehicle",
  "custom",
  "cancelled",
  "leave",
  "terminated",
  "phone_issue",
  "id_suspended",
  "new_hire",
  "training",
] as const;

export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];

const ADJUSTMENT_STATUS_SET: ReadonlySet<string> = new Set(ADJUSTMENT_STATUSES);

/** SOP short code → the word the panel reads back. */
const ADJUSTMENT_STATUS_ALIASES: Record<string, AdjustmentStatus> = {
  abs: "absent",
  alh: "abs_lh",
  alo: "abs_lo",
  act: "actual",
  cus: "custom",
  vehicle_issue: "vehicle",
};

/** Trims, lowercases and resolves an alias; `null` when the cell names no day type. */
export function normalizeAdjustmentStatus(raw: unknown): AdjustmentStatus | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (ADJUSTMENT_STATUS_SET.has(value)) return value as AdjustmentStatus;
  return ADJUSTMENT_STATUS_ALIASES[value] ?? null;
}

/** The text a refusal carries: `invalid_adjustment_status:<what arrived>`. */
export function adjustmentStatusCode(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}
