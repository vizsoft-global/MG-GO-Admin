"use server";

import { refresh, revalidatePath, updateTag } from "next/cache";
import { logAdminMutation } from "@/lib/audit/log-admin-activity";
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
import { callAdminFunction } from "@/lib/firebase/callable";
import { getFirebaseStorage } from "@/lib/firebase/admin";
import { APP_SETTINGS_DOC_ID, COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import {
  getSentryDeviceOverview,
  sentryBuildIssuesUrl,
  sentryProjectUrl,
  type SentryDisconnectedReason,
} from "@/lib/sentry/sentry-api";

const DRIVER_APP_PLAY_URL =
  "https://play.google.com/store/apps/details?id=com.musallam_delivery.app";

type WriteError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

function logWriteError(scope: string, error: WriteError | unknown): void {
  const e = error as WriteError;
  console.error(`[driver-app-settings:${scope}] settings write failed`, {
    code: e?.code ?? null,
    message: e?.message ?? (error instanceof Error ? error.message : null),
    details: e?.details ?? null,
    hint: e?.hint ?? null,
  });
}

function formatWriteErrorDetail(error: WriteError | null | undefined): string | undefined {
  if (!error) return undefined;
  const parts: string[] = [];
  if (error.code) parts.push(`code ${error.code}`);
  if (error.message) parts.push(error.message);
  if (error.details) parts.push(error.details);
  if (error.hint) parts.push(`hint: ${error.hint}`);
  return parts.length > 0 ? parts.join(" — ") : undefined;
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

async function removeStoragePaths(paths: string[]) {
  if (paths.length === 0) return;
  const bucket = await brandingBucket();
  if (!bucket) return;
  await Promise.all(
    paths.map((relativePath) =>
      bucket.file(brandingObjectPath(relativePath)).delete({ ignoreNotFound: true }),
    ),
  );
}

/**
 * Merge fields onto the single app_settings document. A missing document keeps
 * the same diagnostic the panel already shows operators.
 */
async function patchAppSettings(
  scope: string,
  patch: Record<string, unknown>,
  updatedBy: string,
): Promise<{ error?: string; errorDetail?: string }> {
  const db = await staffDb();
  if (!db) return { error: "save_failed", errorDetail: "not_configured" };

  const ref = db.collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID);
  try {
    const existing = await ref.get();
    if (!existing.exists) {
      return {
        error: "save_failed",
        errorDetail:
          "app_settings row id=1 is missing — re-seed it with INSERT INTO app_settings (id) VALUES (1).",
      };
    }
    await ref.set(
      {
        ...patch,
        updated_at: new Date(),
        updated_by: updatedBy,
      },
      { merge: true },
    );
    return {};
  } catch (error) {
    logWriteError(scope, error);
    return {
      error: "save_failed",
      errorDetail: error instanceof Error ? error.message : String(error),
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

  const path = `${DRIVER_APP_LOGO_PREFIX}.${meta.ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await removeStoragePaths(ALLOWED_LOGO_EXTENSIONS.map((e) => `${DRIVER_APP_LOGO_PREFIX}.${e}`));
    const publicUrl = await saveBrandingObject(path, buffer, meta.contentType);
    if (!publicUrl) return { error: "upload_failed" };

    const logoUrl = `${publicUrl}&v=${Date.now()}`;
    const result = await patchAppSettings(
      "uploadDriverAppLogo",
      { driver_app_logo_url: logoUrl },
      auth.session.id,
    );
    if (result.error) return result;

    revalidateDriverAppSettings(locale);
    return { success: true, logoUrl };
  } catch (error) {
    logWriteError("uploadDriverAppLogo:storage", error);
    return {
      error: "upload_failed",
      errorDetail: formatWriteErrorDetail(
        error instanceof Error ? { message: error.message } : undefined,
      ),
    };
  }
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

  const path = `${DRIVER_APP_SPLASH_PREFIX}.${meta.ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await removeStoragePaths(
      ALLOWED_SPLASH_EXTENSIONS.map((e) => `${DRIVER_APP_SPLASH_PREFIX}.${e}`),
    );
    const publicUrl = await saveBrandingObject(path, buffer, meta.contentType);
    if (!publicUrl) return { error: "upload_failed" };

    const splashUrl = `${publicUrl}&v=${Date.now()}`;
    const result = await patchAppSettings(
      "uploadDriverAppSplash",
      { driver_app_splash_url: splashUrl },
      auth.session.id,
    );
    if (result.error) return result;

    revalidateDriverAppSettings(locale);
    return { success: true, splashUrl };
  } catch (error) {
    logWriteError("uploadDriverAppSplash:storage", error);
    return {
      error: "upload_failed",
      errorDetail: formatWriteErrorDetail(
        error instanceof Error ? { message: error.message } : undefined,
      ),
    };
  }
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

  const path = `${DRIVER_APP_ICON_PREFIX}.${meta.ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await removeStoragePaths(ALLOWED_ICON_EXTENSIONS.map((e) => `${DRIVER_APP_ICON_PREFIX}.${e}`));
    const publicUrl = await saveBrandingObject(path, buffer, meta.contentType);
    if (!publicUrl) return { error: "upload_failed" };

    const iconUrl = `${publicUrl}&v=${Date.now()}`;
    const result = await patchAppSettings(
      "uploadDriverAppIcon",
      { driver_app_icon_url: iconUrl },
      auth.session.id,
    );
    if (result.error) return result;

    revalidateDriverAppSettings(locale);
    return { success: true, iconUrl };
  } catch (error) {
    logWriteError("uploadDriverAppIcon:storage", error);
    return {
      error: "upload_failed",
      errorDetail: formatWriteErrorDetail(
        error instanceof Error ? { message: error.message } : undefined,
      ),
    };
  }
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

  const db = await staffDb();
  const beforeSnap = db
    ? await db.collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID).get()
    : null;
  const beforeData = beforeSnap?.data();
  const before = beforeData
    ? {
        driver_app_force_update: beforeData.driver_app_force_update === true,
        driver_app_min_version_code:
          typeof beforeData.driver_app_min_version_code === "number"
            ? beforeData.driver_app_min_version_code
            : null,
        driver_app_min_version_name:
          typeof beforeData.driver_app_min_version_name === "string"
            ? beforeData.driver_app_min_version_name
            : null,
        driver_app_update_message:
          typeof beforeData.driver_app_update_message === "string"
            ? beforeData.driver_app_update_message
            : null,
      }
    : undefined;

  const result = await patchAppSettings("updateDriverAppForceUpdate", patch, auth.session.id);
  if (result.error) return result;

  revalidateDriverAppSettings(locale);
  void logAdminMutation({
    action: "update",
    entityType: "app_settings",
    entityId: "1",
    routeName: "updateDriverAppForceUpdate",
    before,
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
  /** Newest login seen on this build, so a dead build is visible as dead. */
  lastSeenAt: string | null;
  /** 7-day Sentry error volume for this build; null when Sentry is unreadable. */
  sentryEvents: number | null;
  sentryUrl: string | null;
};

export type DriverAppInstallStats = {
  total: number;
  versions: DriverAppInstallVersion[];
  loadFailed: boolean;
  /**
   * Whether the Sentry column can be believed. A disconnected Sentry has to be
   * named rather than rendered as zero errors — the two are opposite facts.
   */
  sentry: { connected: boolean; reason: SentryDisconnectedReason | null; projectUrl: string };
};

type InstallVersionRow = {
  driver_id: string;
  app_version_code: number | null;
  app_version_name: string | null;
  last_seen_at: string | null;
};

const RECENT_INSTALL_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function seenAt(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (value && typeof value === "object" && "_seconds" in value) {
    const seconds = (value as { _seconds?: unknown })._seconds;
    if (typeof seconds === "number") return new Date(seconds * 1000).toISOString();
  }
  return null;
}

function installRow(raw: unknown): InstallVersionRow | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const code = row.app_version_code;
  const versionCode =
    typeof code === "number"
      ? code
      : typeof code === "string" && code.trim() !== "" && Number.isFinite(Number(code))
        ? Number(code)
        : null;
  return {
    driver_id: typeof row.driver_id === "string" ? row.driver_id : "",
    app_version_code: versionCode,
    app_version_name: typeof row.app_version_name === "string" ? row.app_version_name : null,
    last_seen_at: seenAt(row.last_seen_at),
  };
}

function installRows(data: unknown): InstallVersionRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const parsed = installRow(row);
    return parsed ? [parsed] : [];
  });
}

/**
 * Which build every active driver is running, read from the device session their
 * current phone logged in with. Lets the operator see how many installs a
 * minimum versionCode will lock out before the toggle is flipped.
 */
export async function getDriverAppInstallStats(): Promise<DriverAppInstallStats> {
  const [versions, overview] = await Promise.all([
    callAdminFunction<unknown>("admin_driver_app_install_versions"),
    getSentryDeviceOverview(),
  ]);
  const sentry = {
    connected: overview.connected,
    reason: overview.connected ? null : overview.reason,
    projectUrl: sentryProjectUrl(),
  };
  if (versions.error) {
    logWriteError("getDriverAppInstallStats", versions.error);
    return { total: 0, versions: [], loadFailed: true, sentry };
  }
  const sentryEventsByCode = new Map<number, number>();
  if (overview.connected) {
    for (const build of overview.builds) {
      if (build.versionCode == null) continue;
      sentryEventsByCode.set(
        build.versionCode,
        (sentryEventsByCode.get(build.versionCode) ?? 0) + build.events,
      );
    }
  }
  const rows = installRows(versions.data);
  const cutoff = Date.now() - RECENT_INSTALL_WINDOW_MS;
  const byCode = new Map<number | null, DriverAppInstallVersion>();
  for (const row of rows) {
    const code = row.app_version_code;
    const entry = byCode.get(code) ?? {
      versionCode: code,
      versionName: row.app_version_name,
      installs: 0,
      recent: 0,
      lastSeenAt: null,
      sentryEvents:
        overview.connected && code != null ? (sentryEventsByCode.get(code) ?? 0) : null,
      sentryUrl: code == null ? null : sentryBuildIssuesUrl(code),
    };
    entry.installs += 1;
    if (row.last_seen_at && new Date(row.last_seen_at).getTime() >= cutoff) entry.recent += 1;
    if (
      row.last_seen_at &&
      (entry.lastSeenAt == null || row.last_seen_at > entry.lastSeenAt)
    ) {
      entry.lastSeenAt = row.last_seen_at;
    }
    if (!entry.versionName && row.app_version_name) entry.versionName = row.app_version_name;
    byCode.set(code, entry);
  }
  const versionList = [...byCode.values()].sort((a, b) => {
    if (a.versionCode == null) return -1;
    if (b.versionCode == null) return 1;
    return a.versionCode - b.versionCode;
  });
  return { total: rows.length, versions: versionList, loadFailed: false, sentry };
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
  if ("error" in auth) return { error: "not_authorized" };

  const below = Math.trunc(input.belowVersionCode);
  if (!Number.isFinite(below) || below <= 0) return { error: "invalid_version_code" };
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) return { error: "missing_fields" };

  const versions = await callAdminFunction<unknown>("admin_driver_app_install_versions");
  if (versions.error) {
    logWriteError("notifyOutdatedInstalls", versions.error);
    return { error: "load_failed", errorDetail: formatWriteErrorDetail(versions.error) };
  }
  const driverIds = installRows(versions.data)
    .filter((row) => row.app_version_code == null || row.app_version_code < below)
    .map((row) => row.driver_id)
    .filter(Boolean);
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
