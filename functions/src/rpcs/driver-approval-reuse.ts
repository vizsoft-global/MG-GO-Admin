/**
 * Re-approving a rider who still has a live driver row.
 *
 * An intake is archived, the rider is added again with the same MG ID, and
 * `admin_approve_driver` refuses with `employee_id_exists` — because the live
 * `drivers` row created by the *previous* intake still holds that employee id.
 * The same refusal also hits a rider whose row was created by a *second, still
 * live* intake: the Verify & Approve queue then never issues a passcode and the
 * rider sits in it forever.
 *
 * Re-adopting that row is only safe when the two records are provably the same
 * rider, so the decision is a pure predicate over the clash candidates rather
 * than a policy the transaction improvises.
 */

/** Trimmed, space-collapsed, upper-cased — the comparison the intake import already uses. */
export function normalizedName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ").toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizedPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/[^0-9]/g, "");
  return digits.length > 0 ? digits : null;
}

/**
 * What `drivers.intake_id` of a live row points at.
 *
 * `unknown` covers a row written before `intake_id` existed and a pointer whose
 * intake document cannot be read — neither can prove the row is still in use.
 */
export type PreviousIntakeState = "archived" | "live" | "unknown";

/** One live driver that already holds this intake's employee id. */
export type LiveDriverClash = {
  id: string;
  /** `drivers.archived_at` — a non-null value means the lock is already released. */
  archivedAt: unknown;
  fullName: unknown;
  phone: unknown;
  previousIntake: PreviousIntakeState;
  /**
   * Whether `profiles/{id}` exists. A driver row without a profile is the debris a
   * half-finished approval leaves behind: it can never sign in (login reads the
   * profile), so its identity is not one a rider holds and it must not outrank the
   * row that an activated rider actually uses.
   */
  hasProfile: boolean;
};

/**
 * How strong a claim a live row has on the identity, highest first.
 *
 * A row that can sign in beats one that cannot, a row whose name agrees with the
 * intake beats a nameless leftover, and an agreeing phone breaks the last tie.
 * Only a unique maximum is adopted, so two equally attested rows stay ambiguous
 * rather than one of them being picked arbitrarily.
 */
function claimStrength(clash: LiveDriverClash, name: string, phone: string | null): number {
  const rowPhone = normalizedPhone(clash.phone);
  return (
    (clash.hasProfile ? 4 : 0) +
    (normalizedName(clash.fullName) === name ? 2 : 0) +
    (phone !== null && rowPhone !== null && phone === rowPhone ? 1 : 0)
  );
}

export type ReuseDecision =
  | { kind: "none" }
  | { kind: "reuse"; driverId: string }
  /** More than one live row qualifies, so there is no single row to adopt. */
  | { kind: "ambiguous" };

/**
 * Adopt an existing driver row only when it carries the same name and does not
 * disagree about the phone number.
 *
 * A row whose intake is still `live` is owned by another intake, so there the
 * phone has to match on both sides before the row is considered the same rider
 * — the name alone is not proof that two intake records are one person. An
 * archived or unreadable intake pointer cannot prove ownership at all, so the
 * name is the gate and a one-sided phone (an intake re-entered without a number,
 * or a number added afterwards) is allowed.
 */
export function pickReusableDriver(input: {
  intakeName: unknown;
  intakePhone: unknown;
  clashes: readonly LiveDriverClash[];
}): ReuseDecision {
  const name = normalizedName(input.intakeName);
  const phone = normalizedPhone(input.intakePhone);
  if (!name) return { kind: "none" };

  const candidates = input.clashes.filter((clash) => {
    if (clash.archivedAt != null) return false;
    const clashName = normalizedName(clash.fullName);
    // A live row that carries no name at all cannot contradict the intake, so it is judged
    // on the phone alone. That row is the shape an older approval left behind (a driver
    // document with an employee id and history but no name on it), and refusing it would
    // keep the rider in the queue forever for an id the panel already treats as theirs.
    if (clashName !== null && clashName !== name) return false;
    // A row with no profile cannot sign in at all, so no intake actually holds it: it is
    // the debris of a half-finished approval and the name gate above is the whole proof.
    if (!clash.hasProfile) return true;
    const clashPhone = normalizedPhone(clash.phone);
    // A row that can sign in is owned by the intake that created it, so a still-live
    // pointer needs the phone to agree before it can be called the same rider.
    if (clash.previousIntake === "live") {
      return phone !== null && clashPhone !== null && phone === clashPhone;
    }
    if (phone !== null && clashPhone !== null) return phone === clashPhone;
    return true;
  });

  if (candidates.length === 0) return { kind: "none" };
  const ranked = candidates
    .map((clash) => ({ clash, strength: claimStrength(clash, name, phone) }))
    .sort((a, b) => b.strength - a.strength);
  if (ranked.length > 1 && ranked[0].strength === ranked[1].strength) {
    // Every candidate at this strength is a row nobody can sign in as (a profile alone is
    // worth 4), so these are two pieces of debris rather than two riders. Neither holds
    // access, and the approval retires the ones it does not adopt, so picking one by id is
    // deterministic and cannot take a login away from anyone.
    if (!ranked[0].clash.hasProfile && !ranked[1].clash.hasProfile) {
      const chosen = ranked
        .filter((entry) => entry.strength === ranked[0].strength)
        .map((entry) => entry.clash.id)
        .sort()[0];
      return { kind: "reuse", driverId: chosen };
    }
    return { kind: "ambiguous" };
  }
  return { kind: "reuse", driverId: ranked[0].clash.id };
}
