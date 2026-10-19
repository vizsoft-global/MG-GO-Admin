/**
 * Figma "FROM THE SYSTEM" chips that are not columns on `drivers`.
 * A string or a finite number is read from the document, then `custom_fields`.
 * The caller checks the driver first and the intake second. Missing means null.
 */
export const ESIGN_SNAPSHOT_EXTRA_KEYS = [
  "position",
  "sponsor",
  "pay_through",
  "bank_number",
  "department",
  "monthly_salary_kwd",
  "years_of_service",
  "max_loan_policy_kwd",
  "previous_loan_outstanding_kwd",
  "policy_check",
] as const;
export type EsignSnapshotExtraKey = (typeof ESIGN_SNAPSHOT_EXTRA_KEYS)[number];

type SnapshotBag = Record<string, unknown>;

function snapshotScalar(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function readNamedSnapshotText(data: SnapshotBag, key: string): string | null {
  const direct = snapshotScalar(data[key]);
  if (direct) return direct;
  const bag = data.custom_fields;
  if (bag && typeof bag === "object" && !Array.isArray(bag)) {
    return snapshotScalar((bag as SnapshotBag)[key]);
  }
  return null;
}

export function readEsignSnapshotExtra(
  driver: SnapshotBag,
  intake: SnapshotBag | null,
): Record<EsignSnapshotExtraKey, string | null> {
  const out = Object.fromEntries(
    ESIGN_SNAPSHOT_EXTRA_KEYS.map((key) => [key, null]),
  ) as Record<EsignSnapshotExtraKey, string | null>;
  for (const key of ESIGN_SNAPSHOT_EXTRA_KEYS) {
    out[key] = readNamedSnapshotText(driver, key) ?? (intake ? readNamedSnapshotText(intake, key) : null);
  }
  return out;
}
