import { getPresignedGetUrl } from "@/lib/storage/r2-client";
import { isR2ObjectKey } from "@/lib/storage/r2-keys";

/** Resolve DB avatar_url into a browser-loadable URL. */
export async function resolveDriverAvatarUrl(
  avatarUrl: string | null | undefined,
): Promise<string | null> {
  if (!avatarUrl) return null;
  const trimmed = avatarUrl.trim();
  if (!trimmed) return null;
  if (!isR2ObjectKey(trimmed)) return trimmed;
  return getPresignedGetUrl(trimmed);
}
