import { normalizePassport } from "./driver-errors";
import { normalizeCivilId, normalizeKuwaitPhone } from "./driver-phone";

/**
 * Civil ID, mobile number and passport are mandatory on every write path.
 *
 * They are the three facts HR reconciles a rider against, so a record that is
 * missing one is refused at save, at create, in the bulk sheet and at approve.
 * The refusal names the field: a generic "something went wrong" toast on a
 * legacy rider would leave the operator hunting a blank they cannot see.
 *
 * A value that is present must still be well-formed — blank is a missing field,
 * a half-typed value is an invalid one — so the operator is told which of the
 * two they are looking at.
 */
export type IdentityField = "civilId" | "phone" | "passport";

export type IdentityFieldError =
  | "missing_identity_fields"
  | "invalid_civil_id"
  | "invalid_phone"
  | "invalid_passport";

export type IdentityInput = {
  civilId: string | null | undefined;
  phone: string | null | undefined;
  passport: string | null | undefined;
};

export type NormalizedIdentity = {
  civilId: string;
  phone: string;
  passport: string;
};

/** One field, in the order the identity card prints them. */
export function identityFieldError(
  field: IdentityField,
  raw: string | null | undefined,
): IdentityFieldError | null {
  const value = String(raw ?? "").trim();
  if (!value) return "missing_identity_fields";
  switch (field) {
    case "civilId":
      return normalizeCivilId(value) ? null : "invalid_civil_id";
    case "phone":
      return normalizeKuwaitPhone(value) ? null : "invalid_phone";
    case "passport":
      return normalizePassport(value) ? null : "invalid_passport";
    default: {
      const never: never = field;
      return never;
    }
  }
}

/** Every failing field, so the form can outline more than the first one. */
export function identityFieldErrors(
  input: IdentityInput,
): Partial<Record<IdentityField, IdentityFieldError>> {
  const errors: Partial<Record<IdentityField, IdentityFieldError>> = {};
  for (const field of ["civilId", "phone", "passport"] as const) {
    const error = identityFieldError(field, input[field]);
    if (error) errors[field] = error;
  }
  return errors;
}

/** The first failing field — what the form scrolls to and focuses. */
export function firstIdentityError(
  input: IdentityInput,
): { field: IdentityField; code: IdentityFieldError } | null {
  for (const field of ["civilId", "phone", "passport"] as const) {
    const code = identityFieldError(field, input[field]);
    if (code) return { field, code };
  }
  return null;
}

/**
 * Normalise all three, or return the first refusal. Server paths use this so a
 * write can never store a value the form accepted but the database would not.
 */
export function normalizeIdentity(
  input: IdentityInput,
): { ok: true; value: NormalizedIdentity } | { ok: false; field: IdentityField; code: IdentityFieldError } {
  const failure = firstIdentityError(input);
  if (failure) return { ok: false, ...failure };
  return {
    ok: true,
    value: {
      civilId: normalizeCivilId(String(input.civilId ?? "").trim()) as string,
      phone: normalizeKuwaitPhone(String(input.phone ?? "").trim()) as string,
      passport: normalizePassport(String(input.passport ?? "").trim()) as string,
    },
  };
}

/** Passport normalisation lives with the other identity formats. */
export { normalizePassport };
