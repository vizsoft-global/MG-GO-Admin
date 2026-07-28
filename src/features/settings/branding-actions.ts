"use server";

import { refresh, revalidatePath, updateTag } from "next/cache";
import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import {
  ALLOWED_LOGO_EXTENSIONS,
  DEFAULT_APP_SETTINGS,
  MAX_LOGO_BYTES,
  isFontFamilyId,
  resolveLogoUploadMeta,
} from "@/lib/branding/constants";

function revalidateBranding(locale: string) {
  updateTag("app-settings");
  revalidatePath("/", "layout");
  revalidatePath(`/${locale}`, "layout");
  revalidatePath(`/${locale}/settings/branding`, "page");
  refresh();
}

async function requireSettingsManager() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "settings.manage", session.isSuperAdmin)
  ) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

export async function updateBranding(
  _locale: string,
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
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

  const supabase = await createClient();
  const { error } = await supabase
    .from("app_settings")
    .update({
      app_name: appName,
      app_subtitle: appSubtitle,
      driver_app_login_hint: driverAppLoginHint,
      font_family: fontFamily,
      updated_at: new Date().toISOString(),
      updated_by: auth.session.id,
    })
    .eq("id", 1);

  if (error) {
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
  return { success: true };
}

export async function uploadLogo(
  _locale: string,
  formData: FormData,
): Promise<{ error?: string; success?: boolean; logoUrl?: string }> {
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
  const supabase = await createClient();
  const path = `logo.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  await supabase.storage
    .from("branding")
    .remove(ALLOWED_LOGO_EXTENSIONS.map((e) => `logo.${e}`));

  const { error: uploadError } = await supabase.storage
    .from("branding")
    .upload(path, buffer, {
      contentType,
      upsert: true,
    });

  if (uploadError) {
    return { error: "upload_failed" };
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("branding").getPublicUrl(path);

  const logoUrl = `${publicUrl}?v=${Date.now()}`;

  const { error: updateError } = await supabase
    .from("app_settings")
    .update({
      logo_url: logoUrl,
      logo_type: logoType,
      updated_at: new Date().toISOString(),
      updated_by: auth.session.id,
    })
    .eq("id", 1);

  if (updateError) {
    return { error: "save_failed" };
  }

  revalidateBranding(_locale);
  return { success: true, logoUrl };
}

export async function resetBranding(
  locale: string,
): Promise<{ error?: string; success?: boolean }> {
  const auth = await requireSettingsManager();
  if ("error" in auth) return auth;

  const supabase = await createClient();

  await supabase.storage.from("branding").remove(["logo.png", "logo.jpg", "logo.jpeg", "logo.webp", "logo.svg"]);

  const { error } = await supabase
    .from("app_settings")
    .update({
      app_name: DEFAULT_APP_SETTINGS.app_name,
      app_subtitle: DEFAULT_APP_SETTINGS.app_subtitle,
      font_family: DEFAULT_APP_SETTINGS.font_family,
      logo_url: null,
      logo_type: DEFAULT_APP_SETTINGS.logo_type,
      updated_at: new Date().toISOString(),
      updated_by: auth.session.id,
    })
    .eq("id", 1);

  if (error) {
    return { error: "save_failed" };
  }

  revalidateBranding(locale);
  return { success: true };
}
