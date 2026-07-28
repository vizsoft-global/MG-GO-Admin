import { resolvePartnerLogoMeta } from "@/features/partners/partner-logo";
import {
  allRestaurantLogoKeys,
  buildRestaurantLogoKey,
} from "@/lib/storage/r2-keys";
import { deleteObjects, putObject } from "@/lib/storage/r2-client";

export type RestaurantLogoUploadError =
  | "file_too_large"
  | "invalid_type"
  | "upload_failed";

export async function uploadRestaurantLogoFile(
  restaurantId: string,
  file: File,
  uploadedBy: string,
): Promise<{ error?: RestaurantLogoUploadError; logoUrl?: string }> {
  if (file.size === 0) return {};

  const meta = resolvePartnerLogoMeta(file);
  if (meta.error) return { error: meta.error };
  const { ext, contentType } = meta;
  if (!ext || !contentType) return { error: "invalid_type" };

  const key = buildRestaurantLogoKey(restaurantId, ext);
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await putObject(key, buffer, contentType, {
      uploadedBy,
      entityType: "restaurant_logo",
      entityId: restaurantId,
      uploadedVia: "admin",
    });
  } catch {
    return { error: "upload_failed" };
  }

  return { logoUrl: key };
}

export async function deleteRestaurantLogoFiles(restaurantId: string): Promise<void> {
  try {
    await deleteObjects(allRestaurantLogoKeys(restaurantId));
  } catch {
    /* best-effort */
  }
}

export async function applyRestaurantLogoFromForm(
  restaurantId: string,
  formData: FormData,
  uploadedBy: string,
): Promise<{ logoUrl?: string | null; logoWarning?: RestaurantLogoUploadError }> {
  const logoFile = formData.get("logo");
  const removeLogo = formData.get("removeLogo") === "true";

  if (removeLogo) {
    await deleteRestaurantLogoFiles(restaurantId);
    return { logoUrl: null };
  }

  if (logoFile instanceof File && logoFile.size > 0) {
    await deleteRestaurantLogoFiles(restaurantId);
    const upload = await uploadRestaurantLogoFile(restaurantId, logoFile, uploadedBy);
    if (upload.error) {
      return { logoWarning: upload.error };
    }
    return { logoUrl: upload.logoUrl ?? null };
  }

  return {};
}
