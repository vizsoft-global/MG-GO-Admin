"use client";

import { xhrPut } from "@/lib/http/xhr-put";
import { computeFileSha256 } from "@/lib/storage/file-sha256";
import type { AppReleaseChannel } from "./types";
import {
  parseAppReleaseMetadata,
  validateApkFile,
} from "./app-release-validation";

export type AppReleaseUploadProgress = {
  phase: "hashing" | "uploading" | "registering";
  percent: number;
};

export type AppReleaseUploadInput = {
  file: File;
  versionName: string;
  versionCode: string;
  channel: AppReleaseChannel;
  isRequired: boolean;
  minSupported: string;
  releaseNotes: string;
};

type PresignResponse =
  | {
      ok: true;
      uploadUrl: string;
      objectKey: string;
    }
  | { ok: false; error: string };

type RegisterResponse =
  | { ok: true; release: unknown }
  | { ok: false; error: string };

export async function uploadAppReleaseWithProgress(
  input: AppReleaseUploadInput,
  onProgress: (progress: AppReleaseUploadProgress) => void,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; error: string; details?: string }> {
  const fileCheck = validateApkFile(input.file);
  if (!fileCheck.ok) {
    return { ok: false, error: fileCheck.error };
  }

  const metadata = parseAppReleaseMetadata({
    versionName: input.versionName,
    versionCode: input.versionCode,
    channel: input.channel,
    isRequired: input.isRequired,
    minSupportedVersionCode: input.minSupported,
    releaseNotes: input.releaseNotes,
  });
  if (!metadata.ok) {
    return { ok: false, error: metadata.error };
  }

  let apkSha256: string;
  try {
    onProgress({ phase: "hashing", percent: 0 });
    apkSha256 = await computeFileSha256(input.file);
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("sha256 failed", error);
    }
    return { ok: false, error: "upload_failed" };
  }

  if (signal?.aborted) {
    return { ok: false, error: "upload_failed" };
  }

  let presignJson: PresignResponse;
  try {
    const presignRes = await fetch("/api/admin/app-releases/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: input.file.name,
        sizeBytes: input.file.size,
        versionName: metadata.data.versionName,
        versionCode: metadata.data.versionCode,
        channel: metadata.data.channel,
        isRequired: metadata.data.isRequired,
        minSupportedVersionCode: metadata.data.minSupportedVersionCode,
        releaseNotes: metadata.data.releaseNotes,
      }),
      signal,
    });
    presignJson = (await presignRes.json()) as PresignResponse;
    if (!presignRes.ok || !presignJson.ok) {
      return {
        ok: false,
        error: presignJson.ok ? "upload_failed" : presignJson.error,
      };
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, error: "upload_failed" };
    }
    return { ok: false, error: "upload_failed" };
  }

  onProgress({ phase: "uploading", percent: 0 });
  let putResult: { status: number; responseText: string };
  try {
    putResult = await xhrPut({
      url: presignJson.uploadUrl,
      body: input.file,
      signal,
      onProgress: (progress) => {
        onProgress({ phase: "uploading", percent: progress.percent });
      },
    });
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("R2 PUT failed", error);
    }
    return {
      ok: false,
      error: "r2_cors_or_network",
      details:
        error instanceof Error ? error.message : "Unknown PUT error (likely CORS)",
    };
  }

  if (putResult.status < 200 || putResult.status >= 300) {
    if (process.env.NODE_ENV === "development") {
      console.error("R2 PUT non-2xx", putResult.status, putResult.responseText);
    }
    return {
      ok: false,
      error: "r2_upload_rejected",
      details: `R2 returned ${putResult.status}`,
    };
  }

  onProgress({ phase: "registering", percent: 100 });
  try {
    const registerRes = await fetch("/api/admin/app-releases/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...metadata.data,
        objectKey: presignJson.objectKey,
        apkSha256,
        apkSizeBytes: input.file.size,
      }),
      signal,
    });

    const registerJson = (await registerRes.json()) as RegisterResponse;
    if (!registerRes.ok || !registerJson.ok) {
      return {
        ok: false,
        error: registerJson.ok ? "upload_failed" : registerJson.error,
      };
    }
  } catch {
    return { ok: false, error: "upload_failed" };
  }

  return { ok: true };
}
