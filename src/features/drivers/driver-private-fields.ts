/**
 * The Profile fields that belong to HR rather than to Operations.
 *
 * They live on the intake (the edit source of truth) and are copied to the
 * linked `drivers` row on approval, so the Profile, the list and payroll all
 * read one value. `bank_number` is the existing `iban` column under its new
 * label — no second column.
 */

export const JOB_POSITIONS = ["rider", "light_driver"] as const;
export type DriverJobPosition = (typeof JOB_POSITIONS)[number];

export const HIRING_TYPES = ["overseas", "old_local", "new_local", "outsourcing_partner"] as const;
export type DriverHiringType = (typeof HIRING_TYPES)[number];

export const JOB_END_DESCRIPTIONS = [
  "end_of_contract",
  "issue_maker",
  "not_willing_to_continue",
  "travelled_not_returned",
] as const;
export type DriverJobEndDescription = (typeof JOB_END_DESCRIPTIONS)[number];

/** The two contracted OFF structures a driver can carry. Blank = no row. */
export const OFFS_STRUCTURE_DAYS = [2, 3] as const;
export type OffsStructureDays = (typeof OFFS_STRUCTURE_DAYS)[number];

export type DriverPrivateInfo = {
  sponsorship_key: string | null;
  job_position: DriverJobPosition | null;
  hiring_type: DriverHiringType | null;
  work_start_date: string | null;
  job_end_date: string | null;
  job_end_description: DriverJobEndDescription | null;
  residency_expiry_date: string | null;
  fixed_salary: number | null;
  work_permit_salary: number | null;
  last_increment_date: string | null;
};

export const EMPTY_PRIVATE_INFO: DriverPrivateInfo = {
  sponsorship_key: null,
  job_position: null,
  hiring_type: null,
  work_start_date: null,
  job_end_date: null,
  job_end_description: null,
  residency_expiry_date: null,
  fixed_salary: null,
  work_permit_salary: null,
  last_increment_date: null,
};

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_RE = /^\d{1,8}(\.\d{1,3})?$/;

/** A Kuwait calendar date (`YYYY-MM-DD`), or null when the cell is not one. */
export function normalizeYmd(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, 10);
  if (!YMD_RE.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : text;
}

/** A non-negative KWD amount with at most three decimals. */
export function normalizeMoney(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) / 1000 : null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/,/g, "");
  if (!text) return null;
  if (!MONEY_RE.test(text)) return null;
  return Math.round(Number(text) * 1000) / 1000;
}

/**
 * A date cell from a form: empty is fine (`null`), but a filled cell that is
 * not a real `YYYY-MM-DD` is refused rather than silently dropped.
 */
export function parseOptionalYmd(value: unknown): { ok: boolean; value: string | null } {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return { ok: true, value: null };
  const ymd = normalizeYmd(raw);
  return { ok: ymd !== null, value: ymd };
}

/** The same rule for a money cell. */
export function parseOptionalMoney(value: unknown): { ok: boolean; value: number | null } {
  const raw = typeof value === "string" ? value.trim() : value;
  if (raw == null || raw === "") return { ok: true, value: null };
  const amount = normalizeMoney(raw);
  return { ok: amount !== null, value: amount };
}

export function isJobPosition(value: string): value is DriverJobPosition {
  return (JOB_POSITIONS as readonly string[]).includes(value);
}

export function isHiringType(value: string): value is DriverHiringType {
  return (HIRING_TYPES as readonly string[]).includes(value);
}

export function isJobEndDescription(value: string): value is DriverJobEndDescription {
  return (JOB_END_DESCRIPTIONS as readonly string[]).includes(value);
}

/**
 * A profile select that may be left blank. `""` and `"none"` store null.
 * A filled value that is not in the enum is refused, so a typo cannot land
 * as a silent clear.
 */
export function optionalChoice<T extends string>(
  raw: unknown,
  accept: (value: string) => value is T,
): { ok: true; value: T | null } | { ok: false } {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text || text === "none") return { ok: true, value: null };
  return accept(text) ? { ok: true, value: text } : { ok: false };
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function parsePrivateInfo(row: Record<string, unknown> | null | undefined): DriverPrivateInfo {
  if (!row) return { ...EMPTY_PRIVATE_INFO };
  const position = textOrNull(row.job_position);
  const hiring = textOrNull(row.hiring_type);
  const endReason = textOrNull(row.job_end_description);
  return {
    sponsorship_key: textOrNull(row.sponsorship_key),
    job_position: position && isJobPosition(position) ? position : null,
    hiring_type: hiring && isHiringType(hiring) ? hiring : null,
    work_start_date: normalizeYmd(row.work_start_date),
    job_end_date: normalizeYmd(row.job_end_date),
    job_end_description:
      endReason && isJobEndDescription(endReason) ? endReason : null,
    residency_expiry_date: normalizeYmd(row.residency_expiry_date),
    fixed_salary: normalizeMoney(row.fixed_salary),
    work_permit_salary: normalizeMoney(row.work_permit_salary),
    last_increment_date: normalizeYmd(row.last_increment_date),
  };
}

const PRIVATE_KEYS = [
  "sponsorship_key",
  "job_position",
  "hiring_type",
  "work_start_date",
  "job_end_date",
  "job_end_description",
  "residency_expiry_date",
  "fixed_salary",
  "work_permit_salary",
  "last_increment_date",
] as const;

/**
 * The Profile's private fields, preferring the linked `drivers` row (the live,
 * approved copy) and falling back to the intake (the editable draft).
 */
export function mergePrivateInfo(
  intake: Record<string, unknown> | null | undefined,
  linked: Record<string, unknown> | null | undefined,
): DriverPrivateInfo {
  const pick = (key: (typeof PRIVATE_KEYS)[number]) => {
    const primary = linked?.[key];
    if (primary !== null && primary !== undefined && primary !== "") return primary;
    return intake?.[key];
  };
  return parsePrivateInfo(Object.fromEntries(PRIVATE_KEYS.map((key) => [key, pick(key)])));
}
