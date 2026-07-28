import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withCors } from "@/lib/http/cors";
import { createBearerSupabaseClient } from "@/lib/supabase/bearer-client";
import { requireDriverFromRequest } from "@/lib/storage/driver-upload-auth";
import { resolveAppReleaseApkUrl } from "@/lib/storage/app-release-url";

type ActiveReleaseRow = {
  version_name: string;
  version_code: number;
  min_supported_version_code: number | null;
  apk_object_key: string;
  apk_size_bytes: number;
  apk_sha256: string;
  release_notes: string | null;
  is_required: boolean;
};

const VALID_CHANNELS = new Set(["production", "beta", "internal"]);

function readBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const auth = await requireDriverFromRequest(request);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const token = readBearerToken(request);
  if (!token) {
    return NextResponse.json({ error: "missing_token" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const platform = (searchParams.get("platform") ?? "android").toLowerCase();
  const channel = (searchParams.get("channel") ?? "production").toLowerCase();

  if (platform !== "android") {
    return NextResponse.json({ error: "unsupported_platform" }, { status: 400 });
  }
  if (!VALID_CHANNELS.has(channel)) {
    return NextResponse.json({ error: "invalid_channel" }, { status: 400 });
  }

  const versionCodeRaw = searchParams.get("versionCode");
  const versionName = searchParams.get("versionName");
  const versionCode =
    versionCodeRaw != null && versionCodeRaw !== ""
      ? Number.parseInt(versionCodeRaw, 10)
      : NaN;

  const driverDb = createBearerSupabaseClient(token) as unknown as SupabaseClient;

  if (Number.isFinite(versionCode) && versionCode > 0) {
    const { error: recordError } = await driverDb.rpc("driver_record_app_version", {
      p_platform: platform,
      p_channel: channel,
      p_version_name: versionName,
      p_version_code: versionCode,
    });
    if (recordError && process.env.NODE_ENV === "development") {
      console.warn("driver_record_app_version", recordError.message);
    }
  }

  const { data, error } = await driverDb.rpc("driver_get_active_app_release", {
    p_platform: platform,
    p_channel: channel,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (!data || typeof data !== "object") {
    return NextResponse.json(null);
  }

  const release = data as ActiveReleaseRow;
  const apkUrl = await resolveAppReleaseApkUrl(release.apk_object_key);
  if (!apkUrl) {
    return NextResponse.json({ error: "apk_not_found" }, { status: 404 });
  }

  return NextResponse.json({
    version_name: release.version_name,
    version_code: release.version_code,
    min_supported_version_code: release.min_supported_version_code,
    apk_url: apkUrl,
    apk_size_bytes: release.apk_size_bytes,
    apk_sha256: release.apk_sha256,
    release_notes: release.release_notes,
    is_required: release.is_required,
  });
}

export const GET = withCors(handler);
export const OPTIONS = withCors(async () => new Response(null, { status: 204 }));
