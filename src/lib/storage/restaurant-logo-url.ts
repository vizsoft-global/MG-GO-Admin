import { isR2ObjectKey } from "@/lib/storage/r2-keys";
import { getPresignedGetUrl } from "@/lib/storage/r2-client";

/** Resolve DB `logo_url` to a browser-loadable URL (presigned for R2 keys). */
export async function resolveRestaurantLogoUrl(
  logoUrl: string | null | undefined,
): Promise<string | null> {
  if (!logoUrl) return null;
  const trimmed = logoUrl.trim();
  if (!trimmed) return null;
  if (!isR2ObjectKey(trimmed)) return trimmed;
  try {
    return await getPresignedGetUrl(trimmed);
  } catch {
    return null;
  }
}

export async function resolveRestaurantLogoUrls<
  T extends { id: string; logo_url: string | null },
>(restaurants: T[]): Promise<(T & { logo_display_url: string | null })[]> {
  return Promise.all(
    restaurants.map(async (r) => ({
      ...r,
      logo_display_url: await resolveRestaurantLogoUrl(r.logo_url),
    })),
  );
}
