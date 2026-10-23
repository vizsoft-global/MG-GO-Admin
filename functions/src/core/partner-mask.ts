const HIDDEN_FROM_PARTNER = [
  "app_passcode",
  "civil_id",
  "passport_number",
  "phone",
  "iban",
  "bank_details",
  "bank_number",
  "account_number",
  "beneficiary_civil_id",
  "fixed_salary",
  "work_permit_salary",
  "note_internal",
  "screenshots_allowed",
  "is_blocked",
  "blocked_at",
  "blocked_reason",
  "frozen_from",
  "frozen_until",
  "freeze_reason",
  "login_verification",
] as const;

/** Roster row a partner session may see. Project scoping is applied before this. */
export function maskDriverForPartner<T extends Record<string, unknown>>(row: T): T {
  const next: Record<string, unknown> = { ...row };
  for (const key of HIDDEN_FROM_PARTNER) {
    delete next[key];
  }
  return next as T;
}
