import { isR2ObjectKey } from "@/lib/storage/r2-keys";

export function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

const DELIVERY_PROOF_KEY =
  /^drivers\/[^/]+\/(order_proof|pickup_proof|cancel_proof)\//i;

export function isDeliveryProofObjectKey(
  key: string | null | undefined,
): boolean {
  const trimmed = key?.trim() ?? "";
  if (!trimmed || trimmed.includes("..")) return false;
  return DELIVERY_PROOF_KEY.test(trimmed);
}

/** Same-origin href that streams the file with Content-Disposition: attachment. */
export function proofDownloadHref(
  objectKey: string | null | undefined,
): string | null {
  const trimmed = objectKey?.trim() ?? "";
  if (
    !trimmed ||
    isHttpUrl(trimmed) ||
    !isR2ObjectKey(trimmed) ||
    !isDeliveryProofObjectKey(trimmed)
  ) {
    return null;
  }
  return `/api/deliveries/proof-download?key=${encodeURIComponent(trimmed)}`;
}

export function contentDispositionAttachment(filename: string): string {
  const safe = filename.replace(/[\r\n"]/g, "_");
  return `attachment; filename="${safe}"`;
}

export function guessContentTypeFromKey(key: string): string | null {
  const lower = key.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "image/jpeg";
}

export function guessContentTypeFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return guessContentTypeFromKey(path);
  } catch {
    return null;
  }
}

export function proofFilenameFromKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const trimmed = key.trim();
  if (!trimmed) return null;
  if (isHttpUrl(trimmed)) {
    try {
      const parts = new URL(trimmed).pathname.split("/").filter(Boolean);
      return parts[parts.length - 1] ?? null;
    } catch {
      return null;
    }
  }
  const parts = trimmed.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? null;
}
