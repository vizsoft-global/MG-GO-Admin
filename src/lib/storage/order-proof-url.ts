import { isR2ObjectKey } from "@/lib/storage/r2-keys";
import { getPresignedGetUrl, headObject } from "@/lib/storage/r2-client";

const SIGNED_URL_TTL = 900;

export type ResolvedOrderProof = {
  url: string;
  contentType: string | null;
};

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

/** Resolve DB `order_proof_url` (R2 key or legacy URL) to a browser-loadable URL. */
export async function resolveOrderProofUrl(
  rawValue: string | null | undefined,
): Promise<ResolvedOrderProof | null> {
  if (!rawValue) return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  if (isHttpUrl(trimmed)) {
    return { url: trimmed, contentType: guessContentTypeFromUrl(trimmed) };
  }

  if (!isR2ObjectKey(trimmed)) {
    return null;
  }

  const guessedType = guessContentTypeFromKey(trimmed);
  if (guessedType) {
    try {
      const url = await getPresignedGetUrl(trimmed, SIGNED_URL_TTL);
      return { url, contentType: guessedType };
    } catch {
      return null;
    }
  }

  const head = await headObject(trimmed);
  if (!head.exists) {
    return null;
  }

  const url = await getPresignedGetUrl(trimmed, SIGNED_URL_TTL);
  return {
    url,
    contentType: head.contentType ?? guessContentTypeFromKey(trimmed),
  };
}

function guessContentTypeFromKey(key: string): string | null {
  const lower = key.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "image/jpeg";
}

function guessContentTypeFromUrl(url: string): string | null {
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
