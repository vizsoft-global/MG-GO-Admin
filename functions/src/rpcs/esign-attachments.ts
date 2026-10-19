/** Supporting documents per request — shared by the admin and rider callables. */
export const ESIGN_ATTACHMENT_CAP = 5;

const ESIGN_BUCKET = "esign-documents";

export function canAddEsignAttachment(existingCount: number): boolean {
  return Number.isFinite(existingCount) && existingCount < ESIGN_ATTACHMENT_CAP;
}

/** A rider may only register a key under their own uid folder, with no traversal. */
export function isOwnRiderAttachmentKey(uid: string, storageKey: string): boolean {
  const key = storageKey.trim();
  const owner = uid.trim();
  if (!owner || key.includes("..") || key.startsWith("/")) return false;
  return key.startsWith(`${owner}/`);
}

/** R2 object path under the eSign bucket; strips a leading slash, never a second prefix. */
export function esignAttachmentPath(storageKey: string): string {
  return `${ESIGN_BUCKET}/${storageKey.trim().replace(/^\/+/, "")}`;
}
