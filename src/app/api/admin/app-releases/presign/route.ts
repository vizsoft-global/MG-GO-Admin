import { NextResponse } from "next/server";
import { requireReleasesManagerApi } from "@/lib/auth/require-releases-manager";
import {
  MAX_APK_BYTES,
  parseAppReleaseMetadata,
} from "@/features/app-releases/app-release-validation";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAppReleaseApkKey } from "@/lib/storage/r2-keys";
import { getUnsignedContentTypePutUrl } from "@/lib/storage/r2-client";
import { isR2Configured } from "@/lib/storage/r2-config";

export async function POST(request: Request): Promise<Response> {
  const auth = await requireReleasesManagerApi();
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 403 });
  }

  if (!(await isR2Configured())) {
    return NextResponse.json({ ok: false, error: "r2_not_configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const sizeBytes = Number(payload.sizeBytes ?? 0);
  const filename = String(payload.filename ?? "app-release.apk").toLowerCase();

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return NextResponse.json({ ok: false, error: "missing_apk" }, { status: 400 });
  }
  if (sizeBytes > MAX_APK_BYTES) {
    return NextResponse.json({ ok: false, error: "file_too_large" }, { status: 400 });
  }
  if (!filename.endsWith(".apk")) {
    return NextResponse.json({ ok: false, error: "invalid_extension" }, { status: 400 });
  }

  const metadata = parseAppReleaseMetadata({
    versionName: payload.versionName,
    versionCode: payload.versionCode,
    channel: payload.channel,
    isRequired: payload.isRequired,
    minSupportedVersionCode: payload.minSupportedVersionCode,
    releaseNotes: payload.releaseNotes,
  });
  if (!metadata.ok) {
    return NextResponse.json({ ok: false, error: metadata.error }, { status: 400 });
  }

  const admin = createAdminClient() as unknown as SupabaseClient;
  const { channel, versionCode } = metadata.data;

  const { data: existingLatest } = await admin
    .from("app_releases")
    .select("version_code")
    .eq("platform", "android")
    .eq("channel", channel)
    .order("version_code", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingLatest && versionCode <= Number(existingLatest.version_code)) {
    return NextResponse.json({ ok: false, error: "version_code_not_higher" }, { status: 400 });
  }

  const { data: duplicate } = await admin
    .from("app_releases")
    .select("id")
    .eq("platform", "android")
    .eq("channel", channel)
    .eq("version_code", versionCode)
    .maybeSingle();

  if (duplicate) {
    return NextResponse.json({ ok: false, error: "version_code_exists" }, { status: 400 });
  }

  const objectKey = buildAppReleaseApkKey(channel, versionCode);

  try {
    const uploadUrl = await getUnsignedContentTypePutUrl(objectKey, 3600);
    return NextResponse.json({
      ok: true,
      uploadUrl,
      objectKey,
    });
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("app-release presign failed", error);
    }
    return NextResponse.json({ ok: false, error: "upload_failed" }, { status: 500 });
  }
}
