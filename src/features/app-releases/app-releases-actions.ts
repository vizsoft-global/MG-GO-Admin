"use server";

import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createSessionSupabaseClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildAppReleaseApkKey,
  type AppReleaseChannel,
} from "@/lib/storage/r2-keys";
import { deleteObjects, headObject } from "@/lib/storage/r2-client";
import { resolveAppReleaseApkUrl } from "@/lib/storage/app-release-url";
import {
  parseAppReleaseMetadata,
} from "./app-release-validation";
import type {
  AppReleaseAdoptionQueryResult,
  AppReleaseAdoptionResult,
  AppReleaseAdoptionRow,
  AppReleaseDriverRow,
  AppReleaseDriversPage,
  AppReleaseDriversQueryResult,
  AppReleaseMutationResult,
  AppReleaseRow,
  AppReleasesListResult,
} from "./types";

type AppReleasesDb = SupabaseClient;

function releasesDb(): AppReleasesDb {
  return createAdminClient() as unknown as AppReleasesDb;
}

const MAX_APK_BYTES = 100 * 1024 * 1024;

async function requireReleasesManager() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "releases.manage", session.isSuperAdmin)
  ) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

export async function registerAppReleaseRecord(
  input: Record<string, unknown>,
): Promise<AppReleaseMutationResult> {
  const auth = await requireReleasesManager();
  if (auth.error) return { ok: false, error: auth.error };
  const { session } = auth;

  const metadata = parseAppReleaseMetadata(input);
  if (!metadata.ok) {
    return { ok: false, error: metadata.error };
  }

  const objectKey = String(input.objectKey ?? "").trim();
  const apkSha256 = String(input.apkSha256 ?? "").trim().toLowerCase();
  const apkSizeBytes = Number(input.apkSizeBytes ?? 0);

  if (!objectKey) {
    return { ok: false, error: "upload_failed" };
  }
  if (!/^[a-f0-9]{64}$/.test(apkSha256)) {
    return { ok: false, error: "upload_failed" };
  }
  if (!Number.isFinite(apkSizeBytes) || apkSizeBytes <= 0 || apkSizeBytes > MAX_APK_BYTES) {
    return { ok: false, error: "file_too_large" };
  }

  const {
    channel,
    versionName,
    versionCode,
    minSupportedVersionCode,
    releaseNotes,
    isRequired,
  } = metadata.data;

  const expectedKey = buildAppReleaseApkKey(channel, versionCode);
  if (objectKey !== expectedKey) {
    return { ok: false, error: "upload_failed" };
  }

  const admin = releasesDb();

  const { data: existingLatest } = await admin
    .from("app_releases")
    .select("version_code")
    .eq("platform", "android")
    .eq("channel", channel)
    .order("version_code", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingLatest && versionCode <= Number(existingLatest.version_code)) {
    return { ok: false, error: "version_code_not_higher" };
  }

  const head = await headObject(objectKey);
  if (!head.exists) {
    return { ok: false, error: "apk_not_found" };
  }

  const { data, error } = await admin
    .from("app_releases")
    .insert({
      platform: "android",
      channel,
      version_name: versionName,
      version_code: versionCode,
      min_supported_version_code: minSupportedVersionCode,
      apk_object_key: objectKey,
      apk_size_bytes: apkSizeBytes,
      apk_sha256: apkSha256,
      release_notes: releaseNotes,
      is_required: isRequired,
      is_active: false,
      released_by: session.id,
    })
    .select("*")
    .single();

  if (error) {
    await deleteObjects([objectKey]).catch(() => undefined);
    if (error.code === "23505") {
      return { ok: false, error: "version_code_exists" };
    }
    return { ok: false, error: error.message };
  }

  void logAdminMutation({
    action: "create",
    entityType: "app_release",
    entityId: String(data.id),
    routeName: "registerAppReleaseRecord",
    after: { version_name: versionName, version_code: versionCode, channel },
  });

  return { ok: true, release: mapRow(data as Record<string, unknown>) };
}

function mapRow(row: Record<string, unknown>): AppReleaseRow {
  return {
    id: String(row.id),
    platform: String(row.platform),
    channel: row.channel as AppReleaseChannel,
    version_name: String(row.version_name),
    version_code: Number(row.version_code),
    min_supported_version_code:
      row.min_supported_version_code == null
        ? null
        : Number(row.min_supported_version_code),
    apk_object_key: String(row.apk_object_key),
    apk_size_bytes: Number(row.apk_size_bytes),
    apk_sha256: String(row.apk_sha256),
    release_notes: row.release_notes == null ? null : String(row.release_notes),
    is_required: Boolean(row.is_required),
    is_active: Boolean(row.is_active),
    released_at: String(row.released_at),
    released_by: row.released_by == null ? null : String(row.released_by),
  };
}

function mapAdoptionRow(row: Record<string, unknown>): AppReleaseAdoptionRow {
  return {
    version_code: row.version_code == null ? null : Number(row.version_code),
    version_name: String(row.version_name ?? "unknown"),
    driver_count: Number(row.driver_count ?? 0),
    percent: Number(row.percent ?? 0),
    is_active: Boolean(row.is_active),
    is_known_release: Boolean(row.is_known_release),
  };
}

function mapDriverRow(row: Record<string, unknown>): AppReleaseDriverRow {
  return {
    driver_id: String(row.driver_id),
    driver_code: String(row.driver_code),
    full_name: row.full_name == null ? null : String(row.full_name),
    phone: row.phone == null ? null : String(row.phone),
    partner_name: row.partner_name == null ? null : String(row.partner_name),
    version_name: row.version_name == null ? null : String(row.version_name),
    version_code: row.version_code == null ? null : Number(row.version_code),
    app_version_seen_at:
      row.app_version_seen_at == null ? null : String(row.app_version_seen_at),
  };
}

export async function listAppReleases(
  channel: AppReleaseChannel = "production",
): Promise<AppReleasesListResult> {
  const auth = await requireReleasesManager();
  if (auth.error) return { ok: false, error: auth.error };

  const admin = releasesDb();
  const { data, error } = await admin
    .from("app_releases")
    .select("*")
    .eq("platform", "android")
    .eq("channel", channel)
    .order("version_code", { ascending: false });

  if (error) {
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    items: (data ?? []).map((row) => mapRow(row as Record<string, unknown>)),
  };
}

export async function fetchAppReleaseAdoption(
  channel: AppReleaseChannel = "production",
): Promise<AppReleaseAdoptionQueryResult> {
  const auth = await requireReleasesManager();
  if (auth.error) return { ok: false, error: auth.error };

  const sessionClient = await createSessionSupabaseClient();
  const { data, error } = await sessionClient.rpc("admin_app_release_adoption", {
    p_platform: "android",
    p_channel: channel,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const payload = (data ?? {}) as Record<string, unknown>;
  const items = Array.isArray(payload.items)
    ? payload.items.map((row) => mapAdoptionRow(row as Record<string, unknown>))
    : [];

  const result: AppReleaseAdoptionResult = {
    total_drivers: Number(payload.total_drivers ?? 0),
    active_version_code:
      payload.active_version_code == null
        ? null
        : Number(payload.active_version_code),
    items,
  };

  return { ok: true, data: result };
}

export async function fetchAppReleaseDrivers(
  channel: AppReleaseChannel,
  versionCode: number | null,
  search: string,
  page: number,
  pageSize = 50,
): Promise<AppReleaseDriversQueryResult> {
  const auth = await requireReleasesManager();
  if (auth.error) return { ok: false, error: auth.error };

  const sessionClient = await createSessionSupabaseClient();
  const offset = Math.max(0, (page - 1) * pageSize);
  const { data, error } = await sessionClient.rpc("admin_app_release_drivers", {
    p_platform: "android",
    p_channel: channel,
    p_version_code: versionCode ?? undefined,
    p_search: search.trim() || undefined,
    p_limit: pageSize,
    p_offset: offset,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const payload = (data ?? {}) as Record<string, unknown>;
  const items = Array.isArray(payload.items)
    ? payload.items.map((row) => mapDriverRow(row as Record<string, unknown>))
    : [];

  const pageResult: AppReleaseDriversPage = {
    total: Number(payload.total ?? 0),
    limit: Number(payload.limit ?? pageSize),
    offset: Number(payload.offset ?? offset),
    items,
  };

  return { ok: true, data: pageResult };
}

export async function activateAppRelease(
  id: string,
): Promise<AppReleaseMutationResult> {
  const auth = await requireReleasesManager();
  if (auth.error) return { ok: false, error: auth.error };

  const admin = releasesDb();
  const { data: target, error: fetchError } = await admin
    .from("app_releases")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    return { ok: false, error: fetchError.message };
  }
  if (!target) {
    return { ok: false, error: "not_found" };
  }

  const { error: deactivateError } = await admin
    .from("app_releases")
    .update({ is_active: false })
    .eq("platform", target.platform)
    .eq("channel", target.channel)
    .neq("id", id);

  if (deactivateError) {
    return { ok: false, error: deactivateError.message };
  }

  const { data, error } = await admin
    .from("app_releases")
    .update({ is_active: true })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  void logAdminMutation({
    action: "update",
    entityType: "app_release",
    entityId: id,
    routeName: "activateAppRelease",
    after: {
      version_name: target.version_name,
      version_code: target.version_code,
      channel: target.channel,
      is_active: true,
    },
  });

  return { ok: true, release: mapRow(data as Record<string, unknown>) };
}

export async function markAppReleaseRequired(
  id: string,
  required: boolean,
): Promise<AppReleaseMutationResult> {
  const auth = await requireReleasesManager();
  if (auth.error) return { ok: false, error: auth.error };

  const admin = releasesDb();
  const { data: before, error: fetchError } = await admin
    .from("app_releases")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    return { ok: false, error: fetchError.message };
  }
  if (!before) {
    return { ok: false, error: "not_found" };
  }

  const { data, error } = await admin
    .from("app_releases")
    .update({ is_required: required })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  void logAdminMutation({
    action: "update",
    entityType: "app_release",
    entityId: id,
    routeName: "markAppReleaseRequired",
    before: { is_required: before.is_required },
    after: { is_required: required },
  });

  return { ok: true, release: mapRow(data as Record<string, unknown>) };
}

export async function deleteAppRelease(
  id: string,
): Promise<AppReleaseMutationResult> {
  const auth = await requireReleasesManager();
  if (auth.error) return { ok: false, error: auth.error };

  const admin = releasesDb();
  const { data: target, error: fetchError } = await admin
    .from("app_releases")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    return { ok: false, error: fetchError.message };
  }
  if (!target) {
    return { ok: false, error: "not_found" };
  }
  if (target.is_active) {
    return { ok: false, error: "cannot_delete_active" };
  }

  await deleteObjects([target.apk_object_key]).catch(() => undefined);

  const { error } = await admin.from("app_releases").delete().eq("id", id);
  if (error) {
    return { ok: false, error: error.message };
  }

  void logAdminMutation({
    action: "delete",
    entityType: "app_release",
    entityId: id,
    routeName: "deleteAppRelease",
    before: {
      version_name: target.version_name,
      version_code: target.version_code,
      channel: target.channel,
    },
  });

  return { ok: true, release: mapRow(target as Record<string, unknown>) };
}

export async function getAppReleaseDownloadUrl(
  id: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const auth = await requireReleasesManager();
  if (auth.error) return { ok: false, error: auth.error };

  const admin = releasesDb();
  const { data, error } = await admin
    .from("app_releases")
    .select("apk_object_key")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!data?.apk_object_key) {
    return { ok: false, error: "not_found" };
  }

  const url = await resolveAppReleaseApkUrl(data.apk_object_key);
  if (!url) {
    return { ok: false, error: "apk_not_found" };
  }

  return { ok: true, url };
}
