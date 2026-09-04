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
import { sendDirectDriverNotification } from "@/features/notifications/notifications-actions";

const DRIVER_APP_PLAY_URL =
  "https://play.google.com/store/apps/details?id=com.musallam_delivery.app";

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

export type DriverAppForceUpdateInput = {
  enabled: boolean;
  minVersionCode: number | null;
  minVersionName: string | null;
  message: string | null;
};

/**
 * Force-update controls. One action for the whole block rather than a toggle plus
 * three field saves: turning the switch on with a stale or missing versionCode is
 * exactly the state that locks the whole fleet out, so the toggle and the number
 * are validated together.
 */
export async function updateDriverAppForceUpdate(
  locale: string,
  input: DriverAppForceUpdateInput,
): Promise<{ error?: string; errorDetail?: string; success?: boolean }> {
  const auth = await requireSettingsManager();
  if ("error" in auth) return auth;

  const minVersionCode =
    input.minVersionCode == null || Number.isNaN(input.minVersionCode)
      ? null
      : Math.trunc(input.minVersionCode);
  if (minVersionCode != null && (minVersionCode <= 0 || minVersionCode > 2_100_000_000)) {
    return { error: "invalid_version_code" };
  }
  if (input.enabled && minVersionCode == null) {
    return { error: "version_code_required" };
  }

  const minVersionName = input.minVersionName?.trim() || null;
  if (minVersionName && minVersionName.length > 32) {
    return { error: "invalid_version_name" };
  }
  const message = input.message?.trim() || null;
  if (message && message.length > 500) {
    return { error: "invalid_message" };
  }

  const patch = {
    driver_app_force_update: input.enabled,
    driver_app_min_version_code: minVersionCode,
    driver_app_min_version_name: minVersionName,
    driver_app_update_message: message,
  };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("app_settings")
    .select(
      "driver_app_force_update, driver_app_min_version_code, driver_app_min_version_name, driver_app_update_message",
    )
    .eq("id", 1)
    .maybeSingle();

  const result = await patchAppSettings("updateDriverAppForceUpdate", patch, auth.session.id);
  if (result.error) return result;

  revalidateDriverAppSettings(locale);
  void logAdminMutation({
    action: "update",
    entityType: "app_settings",
    entityId: "1",
    routeName: "updateDriverAppForceUpdate",
    before: before ?? undefined,
    after: patch,
  });
  return { success: true };
}

export type DriverAppInstallVersion = {
  versionCode: number | null;
  versionName: string | null;
  installs: number;
  /** Installs whose device logged in within the last 14 days. */
  recent: number;
};

export type DriverAppInstallStats = {
  total: number;
  versions: DriverAppInstallVersion[];
  loadFailed: boolean;
};

type InstallVersionRow = {
  driver_id: string;
  app_version_code: number | null;
  app_version_name: string | null;
  last_seen_at: string | null;
};

const RECENT_INSTALL_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Which build every active driver is running, read from the device session their
 * current phone logged in with. Lets the operator see how many installs a
 * minimum versionCode will lock out before the toggle is flipped.
 */
export async function getDriverAppInstallStats(): Promise<DriverAppInstallStats> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_driver_app_install_versions");
  if (error) {
    logPgError("getDriverAppInstallStats", error);
    return { total: 0, versions: [], loadFailed: true };
  }
  const rows = (data ?? []) as InstallVersionRow[];
  const cutoff = Date.now() - RECENT_INSTALL_WINDOW_MS;
  const byCode = new Map<number | null, DriverAppInstallVersion>();
  for (const row of rows) {
    const code = row.app_version_code;
    const entry = byCode.get(code) ?? {
      versionCode: code,
      versionName: row.app_version_name,
      installs: 0,
      recent: 0,
    };
    entry.installs += 1;
    if (row.last_seen_at && new Date(row.last_seen_at).getTime() >= cutoff) entry.recent += 1;
    if (!entry.versionName && row.app_version_name) entry.versionName = row.app_version_name;
    byCode.set(code, entry);
  }
  const versions = [...byCode.values()].sort((a, b) => {
    // Unknown builds first: they are treated as below any minimum, same as the gate.
    if (a.versionCode == null) return -1;
    if (b.versionCode == null) return 1;
    return a.versionCode - b.versionCode;
  });
  return { total: rows.length, versions, loadFailed: false };
}

export type NotifyOutdatedInstallsResult =
  | { success: true; recipients: number; pushed: number; skipped: number; failed: number }
  | { error: string; errorDetail?: string };

/**
 * Push "please update" with the Play link to every install below the given
 * versionCode. This is the only lever that reaches a build too old to carry the
 * Update Required screen — the force-update toggle cannot show them anything.
 */
export async function notifyOutdatedInstalls(
  input: { belowVersionCode: number; title: string; body: string },
): Promise<NotifyOutdatedInstallsResult> {
  const auth = await requireSettingsManager();
  if (auth.error) return { error: auth.error };

  const below = Math.trunc(input.belowVersionCode);
  if (!Number.isFinite(below) || below <= 0) return { error: "invalid_version_code" };
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) return { error: "missing_fields" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_driver_app_install_versions");
  if (error) {
    logPgError("notifyOutdatedInstalls", error);
    return { error: "load_failed", errorDetail: formatPgErrorDetail(error) };
  }
  const driverIds = ((data ?? []) as InstallVersionRow[])
    .filter((row) => row.app_version_code == null || row.app_version_code < below)
    .map((row) => row.driver_id);
  if (driverIds.length === 0) return { error: "no_outdated_installs" };

  const result = await sendDirectDriverNotification({
    driverIds,
    title,
    body,
    url: DRIVER_APP_PLAY_URL,
    category: "system_alert",
    routeName: "notifyOutdatedInstalls",
  });
  if ("error" in result) {
    return { error: result.error === "not_authorized" ? "notifications_send_required" : result.error };
  }

  void logAdminMutation({
    action: "create",
    entityType: "app_settings",
    entityId: "1",
    routeName: "notifyOutdatedInstalls",
    after: { below_version_code: below, recipients: driverIds.length, pushed: result.sent },
  });

  return {
    success: true,
    recipients: driverIds.length,
    pushed: result.sent,
    skipped: result.skipped,
    failed: result.failed,
  };
}

export async function setDriverAppLoginVerificationExemptAll(
  enabled: boolean,
): Promise<{ error?: string; errorDetail?: string; success?: boolean }> {
  const auth = await requireSettingsManager();
  if ("error" in auth) return auth;

  const result = await patchAppSettings(
    "setDriverAppLoginVerificationExemptAll",
    { driver_app_login_verification_exempt_all: enabled },
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
      driver_app_login_verification_exempt_all: false,
      driver_app_delivery_proximity_meters:
        DEFAULT_DRIVER_APP_SETTINGS.driver_app_delivery_proximity_meters,
      // Always off — sideload OTA removed for Play Store.
      driver_app_sideload_updates_enabled: false,
      driver_app_force_update: false,
      driver_app_min_version_code: null,
      driver_app_min_version_name: null,
      driver_app_update_message: null,
    },
    auth.session.id,
  );
  if (result.error) return result;

  revalidateDriverAppSettings(locale);
  return { success: true };
}
