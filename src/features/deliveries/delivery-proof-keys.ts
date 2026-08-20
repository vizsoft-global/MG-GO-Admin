import type { DeliveryListRow, DeliveryProofShot } from "./types";
import type { SignedProofUrls } from "@/lib/storage/proof-image-url";
import { signedProofUrlsForKey } from "@/lib/storage/proof-image-url";

export const MAX_DELIVERY_PROOFS = 5;

export type { DeliveryProofShot };

/** Scalar first, then extras from the array, de-duplicated. */
export function mergeProofKeys(
  scalar: string | null | undefined,
  urls?: string[] | null,
): string[] {
  const out: string[] = [];
  const first = scalar?.trim() ?? "";
  if (first) out.push(first);
  for (const raw of urls ?? []) {
    const key = raw?.trim() ?? "";
    if (!key || out.includes(key)) continue;
    out.push(key);
    if (out.length >= MAX_DELIVERY_PROOFS) break;
  }
  return out;
}

export function shotsForProofKeys(
  scalar: string | null | undefined,
  urls?: string[] | null,
): DeliveryProofShot[] {
  return mergeProofKeys(scalar, urls).map((objectKey) => {
    const signed: SignedProofUrls = signedProofUrlsForKey(objectKey);
    return {
      objectKey,
      thumbUrl: signed.thumbUrl,
      fullUrl: signed.fullUrl,
      contentType: signed.contentType,
    };
  });
}

export function proofKeysForDelivery(row: DeliveryListRow): string[] {
  return [
    ...mergeProofKeys(row.order_proof_url, row.order_proof_urls),
    ...mergeProofKeys(row.pickup_proof_url, row.pickup_proof_urls),
    ...mergeProofKeys(row.cancel_proof_url, row.cancel_proof_urls),
  ];
}
