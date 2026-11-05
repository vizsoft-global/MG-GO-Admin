/**
 * The two things a duplicate MG ID or mobile number needs to answer:
 *
 * 1. **Who holds it.** `employeeIdExists` / `phoneExists` look at the intake rows
 *    as well as the approved riders, so an unfinished profile (one with no
 *    driver row yet) can block a fresh create while being invisible in the
 *    Employees list — that is the "we searched and found nothing" report.
 * 2. **Whether the operator really means it.** A permanent delete requires the
 *    MG ID typed back, never a single click.
 */

export type IdentityConflictField = "employee_id" | "phone" | "civil_id" | "passport";

/** An unfinished profile (intake), an approved rider, or a bare login profile. */
export type IdentityConflictKind = "intake" | "driver" | "profile";

export type IdentityConflict = {
  field: IdentityConflictField;
  kind: IdentityConflictKind;
  /** Intake id for `intake`, driver/profile id otherwise — the detail route uses it. */
  id: string;
  intakeId: string | null;
  driverId: string | null;
  name: string | null;
  employeeId: string | null;
  phone: string | null;
  /** `archived` | `not_approved` | the rider's account status (`active`, `suspended`, …). */
  state: string;
};

/** The detail route that shows the holder: an intake opens on its own id. */
export function conflictDetailHref(conflict: IdentityConflict): string {
  return `/drivers/${conflict.id}`;
}

/**
 * Case-insensitive, trimmed, and still exact: an MG ID has to be typed back in
 * full before a permanent delete runs.
 */
export function deleteConfirmationMatches(
  input: string,
  expected: string | null | undefined,
): boolean {
  const wanted = String(expected ?? "").trim().toLowerCase();
  if (!wanted) return false;
  return input.trim().toLowerCase() === wanted;
}

/** A conflict the operator can act on without leaving the form. */
export function conflictStateKey(conflict: IdentityConflict): string {
  if (conflict.state === "archived") return "conflictArchived";
  if (conflict.state === "not_approved") return "conflictNotApproved";
  return "conflictRider";
}
