import { isR2ObjectKey } from "@/lib/storage/r2-keys";
import { getPresignedGetUrl, headObject } from "@/lib/storage/r2-client";
import {
  guessContentTypeFromKey,
  guessContentTypeFromUrl,
  isHttpUrl,
} from "@/lib/storage/order-proof-url";

const SIGNED_URL_TTL = 900;

export type ResolvedOrderProof = {
  url: string;
  contentType: string | null;
};

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
