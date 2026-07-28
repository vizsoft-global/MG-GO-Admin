import { resolvePartnerLogoMeta } from "@/features/partners/partner-logo";
import { deleteObjects, putObject } from "@/lib/storage/r2-client";
import {
  allDriverAvatarKeys,
  allIntakeAvatarKeys,
  buildDriverAvatarKey,
  buildIntakeAvatarKey,
} from "@/lib/storage/r2-keys";

type DriverAvatarUploadResult = {
  error?: "file_too_large" | "invalid_file_type" | "upload_failed";
  path?: string;
};

function normalizeAvatarMime(mime: string): string {
  if (mime === "image/svg+xml") return "image/svg+xml";
  if (mime === "image/png") return "image/png";
  if (mime === "image/webp") return "image/webp";
  return "image/jpeg";
}

export async function uploadIntakeAvatarFile(
  intakeId: string,
  file: File,
  uploadedBy: string,
): Promise<DriverAvatarUploadResult> {
  const meta = resolvePartnerLogoMeta(file);
  if (meta.error === "file_too_large") return { error: "file_too_large" };
  if (meta.error || !meta.ext || !meta.contentType) return { error: "invalid_file_type" };

  const key = buildIntakeAvatarKey(intakeId, meta.ext);
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await deleteObjects(allIntakeAvatarKeys(intakeId).filter((k) => k !== key));
    await putObject(key, buffer, normalizeAvatarMime(meta.contentType), {
      uploadedBy,
      entityType: "driver_intake_avatar",
      entityId: intakeId,
      uploadedVia: "admin",
    });
  } catch {
    return { error: "upload_failed" };
  }

  return { path: key };
}

export async function uploadDriverAvatarFile(
  driverId: string,
  file: File,
  uploadedBy: string,
): Promise<DriverAvatarUploadResult> {
  const meta = resolvePartnerLogoMeta(file);
  if (meta.error === "file_too_large") return { error: "file_too_large" };
  if (meta.error || !meta.ext || !meta.contentType) return { error: "invalid_file_type" };

  const key = buildDriverAvatarKey(driverId, meta.ext);
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await deleteObjects(allDriverAvatarKeys(driverId).filter((k) => k !== key));
    await putObject(key, buffer, normalizeAvatarMime(meta.contentType), {
      uploadedBy,
      entityType: "driver_avatar",
      entityId: driverId,
      uploadedVia: "admin",
    });
  } catch {
    return { error: "upload_failed" };
  }

  return { path: key };
}
