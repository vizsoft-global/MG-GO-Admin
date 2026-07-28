import { isR2ObjectKey } from "@/lib/storage/r2-keys";
import { getPresignedGetUrl } from "@/lib/storage/r2-client";

/** Resolve DB `logo_url` to a browser-loadable URL (presigned for R2 keys). */
export async function resolvePartnerLogoUrl(
  logoUrl: string | null | undefined,
): Promise<string | null> {
  if (!logoUrl) return null;
  const trimmed = logoUrl.trim();
  if (!trimmed) return null;
  if (!isR2ObjectKey(trimmed)) return trimmed;
  return getPresignedGetUrl(trimmed);
}

export async function resolvePartnerLogoUrls<T extends { id: string; logo_url: string | null }>(
  partners: T[],
): Promise<(T & { logo_display_url: string | null })[]> {
  return Promise.all(
    partners.map(async (p) => ({
      ...p,
      logo_display_url: await resolvePartnerLogoUrl(p.logo_url),
    })),
  );
}
