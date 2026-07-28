import type { AppReleaseChannel } from "@/lib/storage/r2-keys";

export const MAX_APK_BYTES = 100 * 1024 * 1024;
export const APK_CONTENT_TYPES = new Set([
  "application/vnd.android.package-archive",
  "application/octet-stream",
  "application/zip",
]);

export type AppReleaseMetadataInput = {
  versionName: string;
  versionCode: number;
  channel: AppReleaseChannel;
  isRequired: boolean;
  minSupportedVersionCode: number | null;
  releaseNotes: string | null;
};

export function parseAppReleaseChannel(value: unknown): AppReleaseChannel {
  const channel = String(value ?? "production").trim() as AppReleaseChannel;
  if (channel === "beta" || channel === "internal") return channel;
  return "production";
}

export function validateApkFile(
  file: File | null | undefined,
): { ok: true; contentType: string } | { ok: false; error: string } {
  if (!file || file.size === 0) {
    return { ok: false, error: "missing_apk" };
  }
  if (file.size > MAX_APK_BYTES) {
    return { ok: false, error: "file_too_large" };
  }
  if (!file.name.toLowerCase().endsWith(".apk")) {
    return { ok: false, error: "invalid_extension" };
  }

  const contentType =
    file.type && APK_CONTENT_TYPES.has(file.type)
      ? file.type
      : "application/vnd.android.package-archive";

  return { ok: true, contentType };
}

export function parseAppReleaseMetadata(input: {
  versionName?: unknown;
  versionCode?: unknown;
  channel?: unknown;
  isRequired?: unknown;
  minSupportedVersionCode?: unknown;
  releaseNotes?: unknown;
}): { ok: true; data: AppReleaseMetadataInput } | { ok: false; error: string } {
  const versionName = String(input.versionName ?? "").trim();
  const versionCodeRaw = String(input.versionCode ?? "").trim();
  const versionCode = parseInt(versionCodeRaw, 10);
  const channel = parseAppReleaseChannel(input.channel);
  const isRequired = input.isRequired === true || input.isRequired === "true";
  const minSupportedRaw = String(input.minSupportedVersionCode ?? "").trim();
  const minSupportedVersionCode = minSupportedRaw
    ? parseInt(minSupportedRaw, 10)
    : null;
  const releaseNotes = String(input.releaseNotes ?? "").trim() || null;

  if (!versionName) {
    return { ok: false, error: "missing_version_name" };
  }
  if (!Number.isFinite(versionCode) || versionCode <= 0) {
    return { ok: false, error: "invalid_version_code" };
  }
  if (
    minSupportedVersionCode != null &&
    (!Number.isFinite(minSupportedVersionCode) || minSupportedVersionCode <= 0)
  ) {
    return { ok: false, error: "invalid_min_supported_version_code" };
  }

  return {
    ok: true,
    data: {
      versionName,
      versionCode,
      channel,
      isRequired,
      minSupportedVersionCode,
      releaseNotes,
    },
  };
}
