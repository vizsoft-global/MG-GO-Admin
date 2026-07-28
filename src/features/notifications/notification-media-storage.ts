import { randomUUID } from "crypto";
import { buildNotificationMediaKey } from "@/lib/storage/r2-keys";
import { putObject } from "@/lib/storage/r2-client";
import {
  resolveNotificationMediaMeta,
  type NotificationMediaUploadError,
} from "./notification-media";

export async function uploadNotificationMediaFile(
  file: File,
  uploadedBy: string,
): Promise<{ error?: NotificationMediaUploadError; objectKey?: string }> {
  if (file.size === 0) return {};

  const meta = resolveNotificationMediaMeta(file);
  if (meta.error) return { error: meta.error };
  if (!meta.ext || !meta.contentType) return { error: "invalid_type" };

  const key = buildNotificationMediaKey(randomUUID(), meta.ext);
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await putObject(key, buffer, meta.contentType, {
      uploadedBy,
      entityType: "notification_media",
      uploadedVia: "admin",
    });
  } catch {
    return { error: "upload_failed" };
  }

  return { objectKey: key };
}
