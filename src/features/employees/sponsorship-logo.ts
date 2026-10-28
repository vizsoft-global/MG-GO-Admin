import { resolvePartnerLogoMeta } from "@/features/partners/partner-logo";
import { resolveSourceCompanyLogoUrl } from "@/features/drivers/source-company-logo";
import {
  allSponsorshipLogoKeys,
  buildSponsorshipLogoKey,
} from "@/lib/storage/r2-keys";
import { deleteObjects, putObject } from "@/lib/storage/r2-client";

export type SponsorshipLogoError = "file_too_large" | "invalid_type" | "upload_failed";

export async function uploadSponsorshipLogoFile(
  sponsorshipKey: string,
  file: File,
  uploadedBy: string,
): Promise<{ error?: SponsorshipLogoError; logoUrl?: string }> {
  if (file.size === 0) return {};
  const meta = resolvePartnerLogoMeta(file);
  if (meta.error) return { error: meta.error };
  const { ext, contentType } = meta;
  if (!ext || !contentType) return { error: "invalid_type" };

  const key = buildSponsorshipLogoKey(sponsorshipKey, ext);
  try {
    await putObject(key, Buffer.from(await file.arrayBuffer()), contentType, {
      uploadedBy,
      entityType: "sponsorship_logo",
      entityId: sponsorshipKey,
      uploadedVia: "admin",
    });
  } catch {
    return { error: "upload_failed" };
  }
  return { logoUrl: key };
}

export async function deleteSponsorshipLogoFiles(sponsorshipKey: string): Promise<void> {
  try {
    await deleteObjects(allSponsorshipLogoKeys(sponsorshipKey));
  } catch {
    /* a leftover object must not block the catalog save */
  }
}

export async function resolveSponsorshipLogoUrl(
  logoUrl: string | null | undefined,
): Promise<string | null> {
  return resolveSourceCompanyLogoUrl(logoUrl);
}
