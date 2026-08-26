import { normalizeEmployeeId } from "./driver-errors";
import { normalizeCivilId, normalizeKuwaitPhone } from "./driver-phone";

/**
 * Identity fields required to approve a driver intake.
 *
 * Only name, driver code and employee ID are mandatory: employee ID is half the
 * app credential (with the minted passcode), and the driver code is the account
 * key. Partner, zone, mobile number and civil ID are optional — gating approval
 * on a contact detail would make it optional at creation and mandatory the
 * moment anyone tried to activate the record.
 *
 * A value that *is* present must still be well-formed, so approving cannot be
 * the step that lets a malformed phone through.
 */
export function intakeMissingApprovalFields(intake: {
  phone: string | null;
  full_name: string | null;
  driver_code: string | null;
  civil_id: string | null;
  employee_id: string | null;
}): boolean {
  if (!intake.full_name?.trim() || !intake.driver_code?.trim()) return true;
  if (!normalizeEmployeeId(intake.employee_id ?? "")) return true;

  const phone = intake.phone?.trim();
  if (phone && !normalizeKuwaitPhone(phone)) return true;

  const civilId = intake.civil_id?.trim();
  if (civilId && !normalizeCivilId(civilId)) return true;

  return false;
}
