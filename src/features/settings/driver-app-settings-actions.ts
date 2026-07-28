"use server";

import { refresh, revalidatePath, updateTag } from "next/cache";
import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import {
  ALLOWED_ICON_EXTENSIONS,
  ALLOWED_LOGO_EXTENSIONS,
  ALLOWED_SPLASH_EXTENSIONS,
  DEFAULT_DRIVER_APP_SETTINGS,
  DRIVER_APP_ICON_PREFIX,
  DRIVER_APP_LOGO_PREFIX,
  DRIVER_APP_SPLASH_PREFIX,
  MAX_DELIVERY_PROXIMITY_METERS,
  MAX_ICON_BYTES,
  MAX_LOGO_BYTES,
  MAX_SPLASH_BYTES,
  MIN_DELIVERY_PROXIMITY_METERS,
  resolveLogoUploadMeta,
} from "@/lib/branding/constants";

type PgLikeError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

function logPgError(scope: string, error: PgLikeError | unknown): void {
  const e = error as PgLikeError;
  console.error(`[driver-app-settings:${scope}] supabase mutation failed`, {
    code: e?.code ?? null,
    message: e?.message ?? null,
    details: e?.details ?? null,
    hint: e?.hint ?? null,
  });
}

function formatPgErrorDetail(error: PgLikeError | null | undefined): string | undefined {
  if (!error) return undefined;
  const parts: string[] = [];
  if (error.code) parts.push(`code ${error.code}`);
  if (error.message) parts.push(error.message);
  if (error.details) parts.push(error.details);
  if (error.hint) parts.push(`hint: ${error.hint}`);
  return parts.length > 0 ? parts.join(" — ") : undefined;
}

/**
 * Update one or more app_settings columns. Tries the staff client first
 * (so RLS audit shows the real user) and falls back to the admin client
 * if the staff client returns no rows or any error. Surfaces the actual
 * Postgres diagnostic in `errorDetail` when both attempts fail.
 */
async function patchAppSettings(
  scope: string,
  patch: Record<string, unknown>,
  updatedBy: string,
): Promise<{ error?: string; errorDetail?: string }> {
  const supabase = await createClient();
  const payload = {
    ...patch,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  };

  const { data, error } = await supabase
    .from("app_settings")
    .update(payload)
    .eq("id", 1)
    .select("id");

  if (!error && data && data.length > 0) return {};
  if (error) logPgError(scope, error);

  // Either RLS hid the row, the row was missing, or there was an explicit
  // error. Retry with the admin client so the save still succeeds and we
  // can capture a precise error message if it still fails.
  try {
    const admin = createAdminClient();
    const { data: adminData, error: adminError } = await admin
      .from("app_settings")
      .update(payload)
      .eq("id", 1)
      .select("id");
    if (adminError) {
      logPgError(`${scope}:admin`, adminError);
      return {
        error: "save_failed",
        errorDetail: formatPgErrorDetail(adminError),
      };
    }
    if (!adminData || adminData.length === 0) {
      return {
        error: "save_failed",
        errorDetail:
          "app_settings row id=1 is missing — re-seed it with INSERT INTO app_settings (id) VALUES (1).",
      };
    }
    return {};
  } catch (e) {
    logPgError(`${scope}:admin-throw`, e);
    return {
      error: "save_failed",
      errorDetail: e instanceof Error ? e.message : String(e),
    };
  }
}

function revalidateDriverAppSettings(locale: string) {
  updateTag("app-settings");
  revalidatePath("/", "layout");
  revalidatePath(`/${locale}`, "layout");
  revalidatePath(`/${locale}/settings/app`, "page");
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

function resolveIconUploadMeta(
  file: File,
): { ext: string; contentType: string } | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_ICON_EXTENSIONS.includes(ext as (typeof ALLOWED_ICON_EXTENSIONS)[number])) {
    return null;
  }
  const mimeByExt: Record<(typeof ALLOWED_ICON_EXTENSIONS)[number], string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  };
  const contentType =
    file.type && mimeByExt[ext as (typeof ALLOWED_ICON_EXTENSIONS)[number]]
      ? file.type
      : mimeByExt[ext as (typeof ALLOWED_ICON_EXTENSIONS)[number]];
  if (!contentType) return null;
  return { ext, contentType };
}

function resolveSplashUploadMeta(
  file: File,
): { ext: string; contentType: string } | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_SPLASH_EXTENSIONS.includes(ext as (typeof ALLOWED_SPLASH_EXTENSIONS)[number])) {
    return null;
  }
  const mimeByExt: Record<(typeof ALLOWED_SPLASH_EXTENSIONS)[number], string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  };
  const contentType =
    file.type && mimeByExt[ext as (typeof ALLOWED_SPLASH_EXTENSIONS)[number]]
      ? file.type
      : mimeByExt[ext as (typeof ALLOWED_SPLASH_EXTENSIONS)[number]];
  if (!contentType) return null;
  return { ext, contentType };
}

async function removeStoragePaths(paths: string[]) {
  if (paths.length === 0) return;
  const supabase = await createClient();
  await supabase.storage.from("branding").remove(paths);
}

export async function updateDriverAppSettings(
  locale: string,
  formData: FormData,
): Promise<{ error?: string; errorDetail?: string; success?: boolean }> {
  const auth = await requireSettingsManager();
  if ("error" in auth) return auth;

  const driverAppTitle = String(formData.get("driverAppTitle") ?? "").trim();
  const driverAppMaintenanceMessage = String(
    formData.get("driverAppMaintenanceMessage") ?? "",
  ).trim();

  if (!driverAppTitle || !driverAppMaintenanceMessage) {
    return { error: "missing_fields" };
  }

  const result = await patchAppSettings(
    "updateDriverAppSettings",
    {
      driver_app_title: driverAppTitle,
      driver_app_maintenance_message: driverAppMaintenanceMessage,
    },
    auth.session.id,
  );

  if (result.error) return result;

  revalidateDriverAppSettings(locale);
  return { success: true };
}

export async function updateDriverAppMaintenanceMessage(
  locale: string,
  message: string,
): Promise<{ error?: string; errorDetail?: string; success?: boolean }> {
  const auth = await requireSettingsManager();
  if ("error" in auth) return auth;

  const trimmed = message.trim();
  if (!trimmed) {
    return { error: "missing_fields" };
  }

  const result = await patchAppSettings(
    "updateDriverAppMaintenanceMessage",
    { driver_app_maintenance_message: trimmed },
    auth.session.id,
  );
  if (result.error) return result;

  revalidateDriverAppSettings(locale);
  return { success: true };
}

export async function updateDriverAppDeliveryProximity(
  locale: string,
  meters: number,
): Promise<{ error?: string; errorDetail?: string; success?: boolean }> {
  const auth = await requireSettingsManager();
  if ("error" in auth) return auth;

  if (
    !Number.isFinite(meters) ||
    meters < MIN_DELIVERY_PROXIMITY_METERS ||
    meters > MAX_DELIVERY_PROXIMITY_METERS
  ) {
    return { error: "invalid_proximity" };
  }

  const result = await patchAppSettings(
    "updateDriverAppDeliveryProximity",
    { driver_app_delivery_proximity_meters: Math.round(meters) },
    auth.session.id,
  );
  if (result.error) return result;

  revalidateDriverAppSettings(locale);
  void logAdminMutation({
    action: "update",
    entityType: "app_settings",
    entityId: "1",
    routeName: "updateDriverAppDeliveryProximity",
    after: { driver_app_delivery_proximity_meters: Math.round(meters) },
  });
  return { success: true };
}

export async function uploadDriverAppLogo(
  locale: string,
  formData: FormData,
): Promise<{ error?: string; errorDetail?: string; success?: boolean; logoUrl?: string }> {
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

  const supabase = await createClient();
  const path = `${DRIVER_APP_LOGO_PREFIX}.${meta.ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  await supabase.storage
    .from("branding")
    .remove(ALLOWED_LOGO_EXTENSIONS.map((e) => `${DRIVER_APP_LOGO_PREFIX}.${e}`));

  const { error: uploadError } = await supabase.storage
    .from("branding")
    .upload(path, buffer, {
      contentType: meta.contentType,
      upsert: true,
    });

  if (uploadError) {
    logPgError("uploadDriverAppLogo:storage", uploadError);
    return {
      error: "upload_failed",
      errorDetail: formatPgErrorDetail(uploadError as PgLikeError),
    };
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("branding").getPublicUrl(path);

  const logoUrl = `${publicUrl}?v=${Date.now()}`;

  const result = await patchAppSettings(
    "uploadDriverAppLogo",
    { driver_app_logo_url: logoUrl },
    auth.session.id,
  );
  if (result.error) return result;

  revalidateDriverAppSettings(locale);
  return { success: true, logoUrl };
}

export async function uploadDriverAppSplash(
  locale: string,
  formData: FormData,
): Promise<{ error?: string; errorDetail?: string; success?: boolean; splashUrl?: string }> {
  const auth = await requireSettingsManager();
  if ("error" in auth) return auth;

  const file = formData.get("splash") as File | null;
  if (!file || file.size === 0) {
    return { error: "missing_file" };
  }
  if (file.size > MAX_SPLASH_BYTES) {
    return { error: "file_too_large" };
  }

  const meta = resolveSplashUploadMeta(file);
  if (!meta) {
    return { error: "invalid_type" };
  }

  const supabase = await createClient();
  const path = `${DRIVER_APP_SPLASH_PREFIX}.${meta.ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  await supabase.storage
    .from("branding")
    .remove(ALLOWED_SPLASH_EXTENSIONS.map((e) => `${DRIVER_APP_SPLASH_PREFIX}.${e}`));

  const { error: uploadError } = await supabase.storage
    .from("branding")
    .upload(path, buffer, {
      contentType: meta.contentType,
      upsert: true,
    });

  if (uploadError) {
    logPgError("uploadDriverAppSplash:storage", uploadError);
    return {
      error: "upload_failed",
      errorDetail: formatPgErrorDetail(uploadError as PgLikeError),
    };
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("branding").getPublicUrl(path);

  const splashUrl = `${publicUrl}?v=${Date.now()}`;

  const result = await patchAppSettings(
    "uploadDriverAppSplash",
    { driver_app_splash_url: splashUrl },
    auth.session.id,
  );
  if (result.error) return result;

  revalidateDriverAppSettings(locale);
  return { success: true, splashUrl };
}

export async function uploadDriverAppIcon(
  locale: string,
  formData: FormData,
): Promise<{ error?: string; errorDetail?: string; success?: boolean; iconUrl?: string }> {
  const auth = await requireSettingsManager();
  if ("error" in auth) return auth;

  const file = formData.get("icon") as File | null;
  if (!file || file.size === 0) {
    return { error: "missing_file" };
  }
  if (file.size > MAX_ICON_BYTES) {
    return { error: "file_too_large" };
  }

  const meta = resolveIconUploadMeta(file);
  if (!meta) {
    return { error: "invalid_type" };
  }

  const supabase = await createClient();
  const path = `${DRIVER_APP_ICON_PREFIX}.${meta.ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  await supabase.storage
    .from("branding")
    .remove(ALLOWED_ICON_EXTENSIONS.map((e) => `${DRIVER_APP_ICON_PREFIX}.${e}`));

  const { error: uploadError } = await supabase.storage
    .from("branding")
    .upload(path, buffer, {
      contentType: meta.contentType,
      upsert: true,
    });

  if (uploadError) {
    logPgError("uploadDriverAppIcon:storage", uploadError);
    return {
      error: "upload_failed",
      errorDetail: formatPgErrorDetail(uploadError as PgLikeError),
    };
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("branding").getPublicUrl(path);

  const iconUrl = `${publicUrl}?v=${Date.now()}`;

  const result = await patchAppSettings(
    "uploadDriverAppIcon",
    { driver_app_icon_url: iconUrl },
    auth.session.id,
  );
  if (result.error) return result;

  revalidateDriverAppSettings(locale);
  return { success: true, iconUrl };
}

export async function setDriverAppMaintenanceMode(
  enabled: boolean,
): Promise<{ error?: string; errorDetail?: string; success?: boolean }> {
  const auth = await requireSettingsManager();
  if ("error" in auth) return auth;

  const result = await patchAppSettings(
    "setDriverAppMaintenanceMode",
    { driver_app_maintenance_mode: enabled },
    auth.session.id,
  );
  if (result.error) return result;

  updateTag("app-settings");
  return { success: true };
}

export async function resetDriverAppSettings(
  locale: string,
): Promise<{ error?: string; errorDetail?: string; success?: boolean }> {
  const auth = await requireSettingsManager();
  if ("error" in auth) return auth;

  await removeStoragePaths([
    ...ALLOWED_LOGO_EXTENSIONS.map((e) => `${DRIVER_APP_LOGO_PREFIX}.${e}`),
    ...ALLOWED_SPLASH_EXTENSIONS.map((e) => `${DRIVER_APP_SPLASH_PREFIX}.${e}`),
    ...ALLOWED_ICON_EXTENSIONS.map((e) => `${DRIVER_APP_ICON_PREFIX}.${e}`),
  ]);

  const result = await patchAppSettings(
    "resetDriverAppSettings",
    {
      driver_app_title: DEFAULT_DRIVER_APP_SETTINGS.driver_app_title,
      driver_app_logo_url: null,
      driver_app_splash_url: null,
      driver_app_icon_url: null,
      driver_app_maintenance_mode: false,
      driver_app_maintenance_message:
        DEFAULT_DRIVER_APP_SETTINGS.driver_app_maintenance_message,
      driver_app_delivery_proximity_meters:
        DEFAULT_DRIVER_APP_SETTINGS.driver_app_delivery_proximity_meters,
    },
    auth.session.id,
  );
  if (result.error) return result;

  revalidateDriverAppSettings(locale);
  return { success: true };
}
