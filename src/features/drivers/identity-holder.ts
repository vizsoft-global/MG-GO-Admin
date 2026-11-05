/**
 * When a stored row still *owns* an identity (MG ID, phone, civil ID, passport).
 *
 * The SQL schema this panel replaced was a **partial** unique index —
 * `WHERE archived_at IS NULL` — so an archived rider never blocked an identity.
 * Firestore has no partial index, so `uniq_*` lock documents stand in for it and
 * the same rule has to be applied by hand, in two places:
 *
 * - the create/update pre-checks (`employeeIdExists`, `phoneExists`, …), and
 * - the lock claim inside `writeLocked`.
 *
 * A driver row stops owning the identity when it can no longer sign in as that
 * rider: it is archived, or it never got its `profiles/{id}` document. The second
 * shape is the debris a refused or cancelled approval leaves behind — the driver
 * row lands, the profile write does not. It is invisible in the Employees list,
 * which is read from `driver_intakes`, and it cannot log in, yet it kept the MG ID
 * and the phone reserved for ever: that is the "MG ID is already assigned to
 * another driver" report where the operator cannot find any such driver.
 *
 * `admin_approve_driver` already applies exactly this rule on its way in
 * (`releasableIdentityHolders`), so the pre-check refusing earlier than the
 * approval could ever accept was the inconsistency.
 */
export type IdentityHolder = {
  /** Stored `archived_at`; any non-empty value means the row was archived. */
  archivedAt?: string | null;
  /** Whether `profiles/{driverId}` exists — sign-in reads it. */
  hasProfile: boolean;
};

/** True when the row no longer holds the identity it still carries. */
export function holderIsReleasable(holder: IdentityHolder): boolean {
  if (holder.archivedAt != null && holder.archivedAt !== "") return true;
  return !holder.hasProfile;
}

/**
 * The records a lock's `owner_id` can point at.
 *
 * `driver` is the owner's driver row when it has one; an intake that is still
 * waiting for its rider legitimately holds the identity, so a missing driver there
 * is not a release.
 */
export type LockOwnerState = {
  /** An intake, driver or profile document exists for the owner. */
  found: boolean;
  /** The owner's intake is archived. */
  intakeArchived: boolean;
  /** The owner's driver row, when one exists. */
  driver: IdentityHolder | null;
};

/**
 * A lock nobody can use any more: the owner record was deleted, archived, or is a
 * driver row that never got a profile. Those locks are what make a brand-new
 * employee fail with "already assigned" even though no such rider is listed.
 */
export function lockOwnerIsStale(state: LockOwnerState): boolean {
  if (!state.found) return true;
  if (state.intakeArchived) return true;
  if (state.driver) return holderIsReleasable(state.driver);
  return false;
}
