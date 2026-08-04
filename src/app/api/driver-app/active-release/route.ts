import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withCors } from "@/lib/http/cors";
import { createBearerSupabaseClient } from "@/lib/supabase/bearer-client";
import { requireDriverFromRequest } from "@/lib/storage/driver-upload-auth";
import { APP_RELEASE_CHANNEL } from "@/lib/app-version/channel";

/**
 * Driver app version adoption ping only.
 * In-app APK / sideload OTA was removed for Play Store policy — never returns apk_url.
 * Single channel: any `channel` query param from older builds is ignored.
 */
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
  const versionCodeRaw = searchParams.get("versionCode");
  const versionName = searchParams.get("versionName");
  const versionCode =
    versionCodeRaw != null && versionCodeRaw !== ""
      ? Number.parseInt(versionCodeRaw, 10)
      : NaN;

  // Best-effort adoption: record installed version if the driver app still calls this.
  if (Number.isFinite(versionCode) && versionCode > 0) {
    const driverDb = createBearerSupabaseClient(token) as unknown as SupabaseClient;
    const { error: recordError } = await driverDb.rpc("driver_record_app_version", {
      p_platform: platform,
      p_channel: APP_RELEASE_CHANNEL,
      p_version_name: versionName,
      p_version_code: versionCode,
    });
    if (recordError && process.env.NODE_ENV === "development") {
      console.warn("driver_record_app_version", recordError.message);
    }
  }

  // Always no active sideload release (Play Store only).
  return NextResponse.json(null);
}

export const GET = withCors(handler);
export const OPTIONS = withCors(async () => new Response(null, { status: 204 }));
