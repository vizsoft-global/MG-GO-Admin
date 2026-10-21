/**
 * What `createPendingUpload` should do with the row already stored under an
 * object key.
 *
 * Kept pure and separate from Firestore so the retry rules are testable without
 * an emulator:
 *
 * * `create` — nothing is stored under the key, so write a fresh pending row.
 * * `reuse`  — the caller's own row is still `pending` (a genuine retry of the
 *   same presign, or a second photo that landed on the same key). Refreshing it
 *   is idempotent and keeps `confirmPendingUpload` working.
 * * `conflict` — anything else. A row uploaded by *another* rider is a real
 *   collision and must never be reused.
 */
export type PendingUploadDecision = "create" | "reuse" | "conflict";

export type PendingUploadExisting = {
  status?: unknown;
  uploaded_by?: unknown;
} | null | undefined;

export function pendingUploadDecision(
  existing: PendingUploadExisting,
  params: { uploadedBy: string },
): PendingUploadDecision {
  if (!existing) return "create";
  if (existing.status !== "pending") return "conflict";
  if (typeof existing.uploaded_by !== "string") return "conflict";
  if (existing.uploaded_by !== params.uploadedBy) return "conflict";
  return "reuse";
}
