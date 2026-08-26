/**
 * Client ID and Client name are free text: the company a rider is supplied to,
 * shared by every rider on the same contract. They carry no format and no
 * uniqueness — only a length cap, which exists so a pasted paragraph is
 * refused in the preview rather than aborting a whole import batch on a
 * database CHECK.
 *
 * Caps match `driver_intakes_client_id_chk` / `driver_intakes_client_name_chk`.
 */
export const CLIENT_ID_MAX_LENGTH = 64;
export const CLIENT_NAME_MAX_LENGTH = 120;

/** Trim, and collapse every spelling of "empty" onto NULL. */
export function normalizeClientValue(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

export function clientValueTooLong(
  value: string | null,
  maxLength: number,
): boolean {
  return value !== null && value.length > maxLength;
}
