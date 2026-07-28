import { normalizeEmployeeId } from "./driver-errors";
import { normalizeCivilId } from "./driver-phone";

/** Identity fields required to approve a driver intake. Partner and zone are optional. */
export function intakeMissingApprovalFields(intake: {
  phone: string | null;
  full_name: string | null;
  driver_code: string | null;
  civil_id: string | null;
  employee_id: string | null;
}): boolean {
  if (!intake.phone?.trim() || !intake.full_name?.trim() || !intake.driver_code?.trim()) {
    return true;
  }
  if (!normalizeCivilId(intake.civil_id ?? "")) return true;
  if (!normalizeEmployeeId(intake.employee_id ?? "")) return true;
  return false;
}
