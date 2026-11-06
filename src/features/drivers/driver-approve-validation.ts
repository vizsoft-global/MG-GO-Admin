import { normalizeEmployeeId } from "./driver-errors";
import { identityFieldError, type IdentityField } from "./driver-identity-required";

/**
 * Fields an intake must carry before it can be approved.
 *
 * Name, driver code and employee ID are the account keys. Civil ID, mobile
 * number and passport are mandatory on every write path, so approval is the last
 * gate that refuses a legacy record still missing one instead of minting a login
 * for an employee HR cannot reconcile.
 *
 * Returns the failing field names (empty when complete) rather than a boolean:
 * the panel has to name which field to fill in, and a bare `missing_fields` sent
 * the operator hunting a blank they could not see.
 */
export function intakeMissingApprovalFields(intake: {
  phone: string | null;
  full_name: string | null;
  driver_code: string | null;
  civil_id: string | null;
  employee_id: string | null;
  passport_number?: string | null;
}): string[] {
  const missing: string[] = [];
  if (!intake.full_name?.trim()) missing.push("full_name");
  if (!intake.driver_code?.trim()) missing.push("driver_code");
  if (!normalizeEmployeeId(intake.employee_id ?? "")) missing.push("employee_id");

  const identity: Array<[IdentityField, string]> = [
    ["civilId", "civil_id"],
    ["phone", "phone"],
    ["passport", "passport_number"],
  ];
  const raw: Record<IdentityField, string | null> = {
    civilId: intake.civil_id,
    phone: intake.phone,
    passport: intake.passport_number ?? null,
  };
  for (const [field, column] of identity) {
    if (identityFieldError(field, raw[field])) missing.push(column);
  }
  return missing;
}
