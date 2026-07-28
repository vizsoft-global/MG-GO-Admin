import { createHmac } from "crypto";
import { isR2ObjectKey } from "@/lib/storage/r2-keys";

const THUMB_WIDTH = 640;
const FULL_WIDTH = 1600;

/** Hour-rounded expiry epoch (seconds) — URLs valid until end of current hour + 1. */
function signingExpiryEpoch(): number {
  const hourSec = 3600;
  return Math.floor(Date.now() / 1000 / hourSec + 2) * hourSec;
}

function signPayload(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function guessProofContentType(key: string): string | null {
  const lower = key.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "image/jpeg";
}

export type SignedProofUrls = {
  thumbUrl: string | null;
  fullUrl: string | null;
  contentType: string | null;
};

/**
 * Build a signed Cloudflare Images Worker URL for a private R2 object key.
 * Server-only — requires IMAGES_WORKER_URL + IMAGE_SIGNING_SECRET.
 */
export function signProofImageUrl(
  objectKey: string | null | undefined,
  options: { width: number },
): string | null {
  const key = objectKey?.trim();
  if (!key || !isR2ObjectKey(key)) return null;

  const baseUrl = process.env.IMAGES_WORKER_URL?.replace(/\/$/, "");
  const secret = process.env.IMAGE_SIGNING_SECRET;
  if (!baseUrl || !secret) return null;

  const w = String(options.width);
  const e = String(signingExpiryEpoch());
  const s = signPayload(secret, `${key}:${w}:${e}`);

  const params = new URLSearchParams({ key, w, e, s });
  return `${baseUrl}/?${params.toString()}`;
}

/** Thumb + full signed URLs for a delivery proof object key (no network I/O). */
export function signedProofUrlsForKey(
  objectKey: string | null | undefined,
): SignedProofUrls {
  const key = objectKey?.trim();
  if (!key) return { thumbUrl: null, fullUrl: null, contentType: null };

  const contentType = guessProofContentType(key);
  const isPdf = contentType === "application/pdf";

  if (isPdf) {
    const url = signProofImageUrl(key, { width: FULL_WIDTH });
    return { thumbUrl: url, fullUrl: url, contentType };
  }

  return {
    thumbUrl: signProofImageUrl(key, { width: THUMB_WIDTH }),
    fullUrl: signProofImageUrl(key, { width: FULL_WIDTH }),
    contentType,
  };
}

export { THUMB_WIDTH, FULL_WIDTH };
