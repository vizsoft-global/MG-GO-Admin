import type { ServiceAttachmentMeta } from "./types";

/**
 * Service attachments — invoices, receipts and workshop photos filed against a
 * visit.
 *
 * The rules are pure so the strip can refuse a file **before** a byte leaves the
 * browser, the server action enforces the same numbers again, and the tests read
 * one set. `r2-keys.ts` already allows `vehicles/`, which is why no new key
 * vocabulary was needed.
 */

/** `vehicles/{vehicleId}/service/{uuid}.{ext}` — beside accidents, not inside them. */
export const SERVICE_ATTACHMENT_FOLDER = "service";

export const MAX_SERVICE_ATTACHMENTS = 10;

/** 25 MB: an invoice scan or a phone photo, not a workshop video. */
export const MAX_SERVICE_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export const SERVICE_ATTACHMENT_ACCEPT = "image/*,application/pdf";

const ALLOWED_MIME_PREFIXES = ["image/"] as const;
const ALLOWED_MIME_EXACT = ["application/pdf"] as const;

export function isAllowedServiceMime(contentType: string): boolean {
  const value = contentType.trim().toLowerCase();
  if (!value) return false;
  if (ALLOWED_MIME_PREFIXES.some((prefix) => value.startsWith(prefix))) return true;
  return (ALLOWED_MIME_EXACT as readonly string[]).includes(value);
}

export type ServiceUploadCandidate = {
  size: number;
  contentType: string;
  /** How many attachments the record already holds. */
  existingCount: number;
};

/** Why this file cannot be attached, or `null` when it can. */
export function serviceUploadBlockReason(candidate: ServiceUploadCandidate): string | null {
  if (candidate.existingCount >= MAX_SERVICE_ATTACHMENTS) return "too_many_attachments";
  if (!Number.isFinite(candidate.size) || candidate.size <= 0) return "file_empty";
  if (candidate.size > MAX_SERVICE_ATTACHMENT_BYTES) return "file_too_large";
  if (!isAllowedServiceMime(candidate.contentType)) return "invalid_content_type";
  return null;
}

/** The prefix an admin upload writes under, and the one a saved key must match. */
export function serviceAttachmentKeyPrefix(vehicleId: string): string {
  return `vehicles/${vehicleId}/${SERVICE_ATTACHMENT_FOLDER}/`;
}

/**
 * A saved key has to belong to the record's own vehicle.
 *
 * Without this check any `service.manage` account could file a `drivers/…` object
 * onto a service record and then read it back through the signed-URL door, which
 * is exactly the hole the accident module's equivalent predicate closes.
 */
export function serviceAttachmentKeyProblem(
  key: string,
  options: { vehicleId: string },
): string | null {
  const value = key.trim();
  if (!value) return "invalid_attachment";
  if (value.includes("..") || value.startsWith("/") || value.includes("//")) {
    return "invalid_attachment";
  }
  if (!options.vehicleId.trim()) return "invalid_attachment";
  if (!value.startsWith(serviceAttachmentKeyPrefix(options.vehicleId.trim()))) {
    return "foreign_attachment";
  }
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function count(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Stored rows → the shape the list draws. A legacy row with no array is empty. */
export function normaliseServiceAttachments(value: unknown): ServiceAttachmentMeta[] {
  if (!Array.isArray(value)) return [];
  const out: ServiceAttachmentMeta[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const key = text(row.key);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      file_name: text(row.file_name),
      kind: text(row.kind),
      content_type: text(row.content_type),
      size: count(row.size),
      uploaded_by: text(row.uploaded_by),
      at: text(row.at),
    });
  }
  return out;
}

/** `1.4 MB` / `820 KB`, or `""` when the size was never reported. */
export function formatAttachmentSize(size: number | null): string {
  if (size == null || !Number.isFinite(size) || size <= 0) return "";
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}
