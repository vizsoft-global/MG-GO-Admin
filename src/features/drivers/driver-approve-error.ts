/**
 * An approval refusal that has to carry more than a code.
 *
 * `missing_profile_fields` names which fields the intake still owes, and the
 * panel uses that list to open the Identity card on the field the operator has
 * to fill instead of dropping them on a generic toast.
 */
export class DriverApproveError extends Error {
  readonly code: string;
  readonly fields: string[];

  constructor(code: string, fields: string[] = []) {
    super(code);
    this.name = "DriverApproveError";
    this.code = code;
    this.fields = fields;
  }
}

export function isDriverApproveError(value: unknown): value is DriverApproveError {
  return value instanceof DriverApproveError;
}
