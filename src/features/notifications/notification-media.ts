import { getPresignedGetUrl } from "@/lib/storage/r2-client";
import { isNotificationMediaObjectKey } from "@/lib/storage/r2-keys";

export type NotificationMediaRole = "banner" | "image";

export type NotificationMediaItem = {
  role: NotificationMediaRole;
  type: "image";
  object_key: string;
  alt?: string;
};

export const MAX_NOTIFICATION_MEDIA_BYTES = 2 * 1024 * 1024;
export const FCM_IMAGE_URL_TTL_SECONDS = 604800;

const ALLOWED_MEDIA_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const EXTENSION_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export type NotificationMediaUploadError =
  | "file_too_large"
  | "invalid_type"
  | "upload_failed";

export function resolveNotificationMediaMeta(file: File): {
  error?: NotificationMediaUploadError;
  ext?: string;
  contentType?: string;
} {
  if (file.size > MAX_NOTIFICATION_MEDIA_BYTES) return { error: "file_too_large" };

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_MEDIA_EXTENSIONS.has(ext)) return { error: "invalid_type" };

  const contentType = EXTENSION_MIME[ext] ?? (file.type.startsWith("image/") ? file.type : null);
  if (!contentType) return { error: "invalid_type" };

  return { ext, contentType };
}

export function buildNotificationMediaPayload(input: {
  bannerObjectKey?: string | null;
  imageObjectKey?: string | null;
}): NotificationMediaItem[] {
  const items: NotificationMediaItem[] = [];
  if (input.bannerObjectKey?.trim()) {
    items.push({
      role: "banner",
      type: "image",
      object_key: input.bannerObjectKey.trim(),
    });
  }
  if (input.imageObjectKey?.trim()) {
    items.push({
      role: "image",
      type: "image",
      object_key: input.imageObjectKey.trim(),
    });
  }
  return items;
}

export function parseNotificationMedia(value: unknown): NotificationMediaItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const role = row.role;
    const objectKey = row.object_key;
    if (
      (role !== "banner" && role !== "image") ||
      typeof objectKey !== "string" ||
      !isNotificationMediaObjectKey(objectKey)
    ) {
      return [];
    }
    return [
      {
        role,
        type: "image",
        object_key: objectKey,
        ...(typeof row.alt === "string" && row.alt.trim() ? { alt: row.alt.trim() } : {}),
      },
    ];
  });
}

export function contentTypeFromNotificationObjectKey(objectKey: string): string {
  const ext = objectKey.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MIME[ext] ?? "image/jpeg";
}

export function pickNotificationMediaByRole(
  media: unknown,
  role: NotificationMediaRole,
): NotificationMediaItem | null {
  return parseNotificationMedia(media).find((item) => item.role === role) ?? null;
}

export function pickPushNotificationImageKey(media: unknown): string | null {
  const parsed = parseNotificationMedia(media);
  return (
    parsed.find((item) => item.role === "image")?.object_key ??
    parsed.find((item) => item.role === "banner")?.object_key ??
    null
  );
}

export async function resolveNotificationMediaReadUrl(
  objectKey: string,
  expiresInSeconds = FCM_IMAGE_URL_TTL_SECONDS,
): Promise<string | null> {
  if (!isNotificationMediaObjectKey(objectKey)) return null;
  try {
    return await getPresignedGetUrl(objectKey, expiresInSeconds);
  } catch {
    return null;
  }
}
