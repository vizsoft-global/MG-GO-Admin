import { esignObjectPath, normalizeEsignStorageKey } from "./esign-storage-key";

export const ESIGN_STORAGE_KEY_FIELDS = [
  "document_storage_key",
  "signed_document_storage_key",
  "signature_storage_key",
] as const;

export function esignStorageKeyCandidates(raw: string): string[] {
  const key = normalizeEsignStorageKey(raw);
  if (!key || key.includes("..")) return [];
  const prefixed = esignObjectPath(key);
  return prefixed === key ? [key] : [key, prefixed];
}

export function esignSignatureStoredKey(
  driverId: string,
  requestId: string,
): string | null {
  const uid = driverId.trim();
  const id = requestId.trim();
  if (!uid || !id || uid.includes("/") || uid.includes("..") || id.includes("/") || id.includes("..")) {
    return null;
  }
  return `${uid}/${id}/signature.png`;
}
