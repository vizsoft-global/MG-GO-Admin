export const ESIGN_BUCKET = "esign-documents";

export type EsignDocumentKind = "document" | "signature" | "signed";

/** Strip a leading bucket prefix so createSignedUrl / download hit the object. */
export function normalizeEsignStorageKey(key: string): string {
  const trimmed = key.trim().replace(/^\/+/, "");
  const prefix = `${ESIGN_BUCKET}/`;
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
}

/** R2 object key. Prefix is a folder, not a bucket name. */
export function esignObjectPath(key: string): string {
  return `${ESIGN_BUCKET}/${normalizeEsignStorageKey(key)}`;
}

export function esignDocumentHref(
  requestId: string,
  kind: EsignDocumentKind,
  disposition: "inline" | "attachment" = "attachment",
): string {
  const params = new URLSearchParams({ id: requestId, kind, disposition });
  return `/api/esign/document-download?${params.toString()}`;
}
