import { resolvePartnerLogoMeta } from "@/features/partners/partner-logo";
import {
  allSourceCompanyLogoKeys,
  buildSourceCompanyLogoKey,
  isSourceCompanyLogoKey,
} from "@/lib/storage/r2-keys";
import { deleteObjects, getPresignedGetUrl, putObject } from "@/lib/storage/r2-client";

export type SourceCompanyLogoError = "file_too_large" | "invalid_type" | "upload_failed";

export async function uploadSourceCompanyLogoFile(
  companyKey: string,
  file: File,
  uploadedBy: string,
): Promise<{ error?: SourceCompanyLogoError; logoUrl?: string }> {
  if (file.size === 0) return {};

  const meta = resolvePartnerLogoMeta(file);
  if (meta.error) return { error: meta.error };
  const { ext, contentType } = meta;
  if (!ext || !contentType) return { error: "invalid_type" };

  const key = buildSourceCompanyLogoKey(companyKey, ext);
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await putObject(key, buffer, contentType, {
      uploadedBy,
      entityType: "source_company_logo",
      entityId: companyKey,
      uploadedVia: "admin",
    });
  } catch {
    return { error: "upload_failed" };
  }

  return { logoUrl: key };
}

export async function deleteSourceCompanyLogoFiles(companyKey: string): Promise<void> {
  try {
    await deleteObjects(allSourceCompanyLogoKeys(companyKey));
  } catch {
    /* best-effort — a stale object must never block the row save */
  }
}

/** Apply the `logo` file input from the company form. */
export async function applySourceCompanyLogoFromForm(
  companyKey: string,
  formData: FormData,
  uploadedBy: string,
): Promise<{ logoUrl?: string | null; logoWarning?: SourceCompanyLogoError }> {
  const logoFile = formData.get("logo");
  const removeLogo = formData.get("removeLogo") === "true";

  if (removeLogo) {
    await deleteSourceCompanyLogoFiles(companyKey);
    return { logoUrl: null };
  }

  if (logoFile instanceof File && logoFile.size > 0) {
    await deleteSourceCompanyLogoFiles(companyKey);
    const upload = await uploadSourceCompanyLogoFile(companyKey, logoFile, uploadedBy);
    if (upload.error) return { logoWarning: upload.error };
    return { logoUrl: upload.logoUrl ?? null };
  }

  return {};
}

/** Resolve a stored company logo key to a browser-loadable presigned URL. */
export async function resolveSourceCompanyLogoUrl(
  logoUrl: string | null | undefined,
): Promise<string | null> {
  if (!logoUrl) return null;
  const trimmed = logoUrl.trim();
  if (!trimmed) return null;
  if (!isSourceCompanyLogoKey(trimmed)) return trimmed;
  try {
    return await getPresignedGetUrl(trimmed);
  } catch {
    return null;
  }
}

export async function resolveSourceCompanyLogoUrls<
  T extends { key: string; logo_url: string | null },
>(companies: T[]): Promise<(T & { logo_display_url: string | null })[]> {
  return Promise.all(
    companies.map(async (c) => ({
      ...c,
      logo_display_url: await resolveSourceCompanyLogoUrl(c.logo_url),
    })),
  );
}
