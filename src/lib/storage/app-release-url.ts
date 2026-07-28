import { getPresignedGetUrl } from "@/lib/storage/r2-client";
import { isAppReleaseObjectKey } from "@/lib/storage/r2-keys";

const SIGNED_URL_TTL = 900;

export async function resolveAppReleaseApkUrl(
  objectKey: string,
): Promise<string | null> {
  const trimmed = objectKey.trim();
  if (!isAppReleaseObjectKey(trimmed)) return null;
  return getPresignedGetUrl(trimmed, SIGNED_URL_TTL);
}
