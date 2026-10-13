"use server";

import { refresh, revalidatePath, updateTag } from "next/cache";
import type { Firestore } from "firebase-admin/firestore";
import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { writeWithEpochCounters } from "@/lib/auth/auth-epochs";
import type { EpochCounters } from "@/lib/auth/epoch-cache";
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
import {
  ALLOWED_LOGO_EXTENSIONS,
  DEFAULT_APP_SETTINGS,
  MAX_LOGO_BYTES,
  isFontFamilyId,
  resolveLogoUploadMeta,
} from "@/lib/branding/constants";
import { getFirebaseStorage } from "@/lib/firebase/admin";
import { APP_SETTINGS_DOC_ID, COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";

function revalidateBranding(locale: string) {
  updateTag("app-settings");
  revalidatePath("/", "layout");
  revalidatePath(`/${locale}`, "layout");
  revalidatePath(`/${locale}/settings/branding`, "page");
  refresh();
}

async function requireSettingsManager() {
  const auth = await requireMutationAuth("settings.manage");
  if ("error" in auth) return auth;
  return { session: auth.session };
}

async function writeBrandingSettings(
  db: Firestore,
  patch: Record<string, unknown>,
): Promise<EpochCounters> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) throw new Error(mutationAuth.error);
  const written = await writeWithEpochCounters(db, "settings", ({ tx }) => {
    tx.set(db.collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID), patch, { merge: true });
  });
  return written.epochs;
}

function brandingObjectPath(relativePath: string): string {
  const trimmed = relativePath.replace(/^\/+/, "");
  return trimmed.startsWith("branding/") ? trimmed : `branding/${trimmed}`;
}

async function brandingBucket() {
  const storage = await getFirebaseStorage();
  return storage?.bucket() ?? null;
}

async function saveBrandingObject(
  relativePath: string,
  buffer: Buffer,
  contentType: string,
): Promise<string | null> {
  const bucket = await brandingBucket();
  if (!bucket) return null;
  const objectPath = brandingObjectPath(relativePath);
  const token = crypto.randomUUID();
  await bucket.file(objectPath).save(buffer, {
    contentType,
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

async function removeBrandingObjects(relativePaths: string[]): Promise<void> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) throw new Error(mutationAuth.error);
  const bucket = await brandingBucket();
  if (!bucket) return;
  await Promise.all(
    relativePaths.map((relativePath) =>
      bucket.file(brandingObjectPath(relativePath)).delete({ ignoreNotFound: true }),
    ),
  );
}

export async function updateBranding(
  _locale: string,
  formData: FormData,
): Promise<{ error?: string; success?: boolean; epochs?: EpochCounters }> {
  const auth = await requireSettingsManager();
  if ("error" in auth) return auth;

  const appName = String(formData.get("appName") ?? "").trim();
  const appSubtitle = String(formData.get("appSubtitle") ?? "").trim();
  const driverAppLoginHint = String(formData.get("driverAppLoginHint") ?? "").trim();
  const fontFamily = String(formData.get("fontFamily") ?? "");

  if (!appName || !appSubtitle || !driverAppLoginHint) {
    return { error: "missing_fields" };
  }
  if (!isFontFamilyId(fontFamily)) {
    return { error: "invalid_font" };
  }

  const db = await staffDb();
  if (!db) return { error: "save_failed" };

  let epochs: EpochCounters;
  try {
    epochs = await writeBrandingSettings(db, {
      app_name: appName,
      app_subtitle: appSubtitle,
      driver_app_login_hint: driverAppLoginHint,
      font_family: fontFamily,
      updated_at: new Date(),
      updated_by: auth.session.id,
    });
  } catch {
    return { error: "save_failed" };
  }

  revalidateBranding(_locale);
  void logAdminMutation({
    action: "update",
    entityType: "app_settings",
    entityId: "1",
    routeName: "updateBranding",
    after: { app_name: appName, font_family: fontFamily },
  });
  return { success: true, epochs };
}

export async function uploadLogo(
  _locale: string,
  formData: FormData,
): Promise<{ error?: string; success?: boolean; logoUrl?: string; epochs?: EpochCounters }> {
  const auth = await requireSettingsManager();
  if ("error" in auth) return auth;

  const file = formData.get("logo") as File | null;
  if (!file || file.size === 0) {
    return { error: "missing_file" };
  }
  if (file.size > MAX_LOGO_BYTES) {
    return { error: "file_too_large" };
  }

  const meta = resolveLogoUploadMeta(file);
  if (!meta) {
    return { error: "invalid_type" };
  }

  const { ext, logoType, contentType } = meta;
  const path = `logo.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  await removeBrandingObjects(ALLOWED_LOGO_EXTENSIONS.map((e) => `logo.${e}`));

  const publicUrl = await saveBrandingObject(path, buffer, contentType);
  if (!publicUrl) return { error: "upload_failed" };

  const logoUrl = `${publicUrl}&v=${Date.now()}`;
  const db = await staffDb();
  if (!db) return { error: "save_failed" };

  let epochs: EpochCounters;
  try {
    epochs = await writeBrandingSettings(db, {
      logo_url: logoUrl,
      logo_type: logoType,
      updated_at: new Date(),
      updated_by: auth.session.id,
    });
  } catch {
    return { error: "save_failed" };
  }

  revalidateBranding(_locale);
  return { success: true, logoUrl, epochs };
}

export async function resetBranding(
  locale: string,
): Promise<{ error?: string; success?: boolean; epochs?: EpochCounters }> {
  const auth = await requireSettingsManager();
  if ("error" in auth) return auth;

  await removeBrandingObjects(["logo.png", "logo.jpg", "logo.jpeg", "logo.webp", "logo.svg"]);

  const db = await staffDb();
  if (!db) return { error: "save_failed" };

  let epochs: EpochCounters;
  try {
    epochs = await writeBrandingSettings(db, {
      app_name: DEFAULT_APP_SETTINGS.app_name,
      app_subtitle: DEFAULT_APP_SETTINGS.app_subtitle,
      font_family: DEFAULT_APP_SETTINGS.font_family,
      logo_url: null,
      logo_type: DEFAULT_APP_SETTINGS.logo_type,
      updated_at: new Date(),
      updated_by: auth.session.id,
    });
  } catch {
    return { error: "save_failed" };
  }

  revalidateBranding(locale);
  return { success: true, epochs };
}
