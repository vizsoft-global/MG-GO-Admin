import {
  ACCIDENT_ATTACHMENT_FOLDER,
  MAX_ACCIDENT_ATTACHMENTS,
  MAX_ACCIDENT_ATTACHMENT_BYTES,
  isRiderAccidentKey,
} from "./accident-types";

/**
 * The attachment rules, pure so the screen, the server action and the tests all
 * read one set. `driver-upload-keys.ts` is what actually enforces size and type at
 * presign and confirm; this module is the same rule stated once for the UI
 * (before a byte leaves the phone or the browser) and for the claim proof.
 */

/** `image/*`, PDF, MP4, MOV — video named explicitly, never `video/`. */
export const ACCIDENT_ALLOWED_MIME_PREFIXES = ["image/"] as const;
export const ACCIDENT_ALLOWED_MIME_EXACT = [
  "application/pdf",
  "video/mp4",
  "video/quicktime",
] as const;

export function isAllowedAccidentMime(contentType: string): boolean {
  const value = contentType.trim().toLowerCase();
  if (!value) return false;
  if (ACCIDENT_ALLOWED_MIME_PREFIXES.some((prefix) => value.startsWith(prefix))) return true;
  return (ACCIDENT_ALLOWED_MIME_EXACT as readonly string[]).includes(value);
}

export type AccidentUploadCandidate = {
  size: number;
  contentType: string;
  /** How many attachments the record already holds. */
  existingCount: number;
};

/** Why this file cannot be attached, or `null` when it can. */
export function accidentUploadBlockReason(candidate: AccidentUploadCandidate): string | null {
  if (candidate.existingCount >= MAX_ACCIDENT_ATTACHMENTS) return "too_many_attachments";
  if (!Number.isFinite(candidate.size) || candidate.size <= 0) return "file_empty";
  if (candidate.size > MAX_ACCIDENT_ATTACHMENT_BYTES) return "file_too_large";
  if (!isAllowedAccidentMime(candidate.contentType)) return "invalid_content_type";
  return null;
}

/**
 * The submit-time proof, as one pure predicate.
 *
 * A rider may only file keys under their own
 * `drivers/{uid}/accident_attachment/` prefix; an admin may file a key it uploaded
 * under `vehicles/{id}/`. A key already listed on another case is refused, because
 * one photo must not be claimed twice.
 */
export function accidentAttachmentKeyProblem(
  key: string,
  options: {
    /** Set when the caller is a rider: a foreign prefix is refused. */
    driverId?: string | null;
    /** Keys already referenced by another accident. */
    claimedKeys?: readonly string[];
  } = {},
): string | null {
  const value = key.trim();
  if (!value) return "invalid_attachment";
  if (value.includes("..") || value.startsWith("/") || value.includes("//")) {
    return "invalid_attachment";
  }
  const fromDriver = value.startsWith("drivers/");
  const fromVehicle = value.startsWith("vehicles/");
  if (!fromDriver && !fromVehicle) return "invalid_attachment";
  if (options.driverId) {
    if (!fromDriver) return "foreign_key";
    if (!isRiderAccidentKey(options.driverId, value)) return "foreign_key";
  }
  if (options.claimedKeys?.includes(value)) return "attachment_claimed";
  return null;
}

/** `drivers/{uid}/accident_attachment/{date}/{uuid}.{ext}` */
export function riderAccidentKeyPrefix(driverId: string): string {
  return `drivers/${driverId}/${ACCIDENT_ATTACHMENT_FOLDER}/`;
}

/** The header line above the strip: "3 of 10 · up to 50 MB each". */
export function accidentAttachmentLimitLabel(
  count: number,
  template: (params: { count: number; max: number; mb: number }) => string,
): string {
  return template({
    count,
    max: MAX_ACCIDENT_ATTACHMENTS,
    mb: Math.round(MAX_ACCIDENT_ATTACHMENT_BYTES / (1024 * 1024)),
  });
}
