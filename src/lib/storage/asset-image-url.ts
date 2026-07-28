import { isR2ObjectKey } from "@/lib/storage/r2-keys";
import { getPresignedGetUrl } from "@/lib/storage/r2-client";

/** Resolve DB `image_url` storage key to a browser-loadable URL. */
export async function resolveAssetImageUrl(
  imageUrl: string | null | undefined,
): Promise<string | null> {
  if (!imageUrl) return null;
  const trimmed = imageUrl.trim();
  if (!trimmed) return null;
  if (!isR2ObjectKey(trimmed)) return trimmed;
  return getPresignedGetUrl(trimmed);
}

export async function resolveAssetImageUrls<
  T extends { id: string; image_url?: string | null },
>(rows: T[]): Promise<(T & { image_display_url: string | null })[]> {
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      image_display_url: await resolveAssetImageUrl(row.image_url ?? null),
    })),
  );
}
