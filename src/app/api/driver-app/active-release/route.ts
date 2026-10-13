import { NextResponse } from "next/server";
import { withCors } from "@/lib/http/cors";
import { COLLECTIONS } from "@/lib/firebase/db";
import { getFirebaseFirestore } from "@/lib/firebase/admin";
import { requireDriverFromRequest } from "@/lib/storage/driver-upload-auth";

/**
 * Driver app version adoption ping only.
 * In-app APK / sideload OTA was removed for Play Store policy — never returns apk_url.
 * Any legacy `channel` query param is ignored. The installed build is written on the
 * driver document (`app_version_code` / `app_version_name`); a build at or above
 * `force_app_update_min_code` clears that demand.
 */
function readBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

async function recordDriverAppVersion(
  driverId: string,
  versionCode: number,
  versionName: string | null,
): Promise<void> {
  const db = await getFirebaseFirestore();
  if (!db) return;
  const ref = db.collection(COLLECTIONS.drivers).doc(driverId);
  const snap = await ref.get();
  if (!snap.exists) return;

  const name = versionName?.trim() ? versionName.trim() : null;
  const patch: Record<string, unknown> = {
    app_version_code: versionCode || null,
    app_version_name: name,
  };
  const minCode = asNumber(snap.get("force_app_update_min_code"));
  if (minCode !== null && versionCode >= minCode) {
    patch.force_app_update_at = null;
    patch.force_app_update_min_code = null;
    patch.force_app_update_by = null;
  }
  await ref.set(patch, { merge: true });
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
  const versionCodeRaw = searchParams.get("versionCode");
  const versionName = searchParams.get("versionName");
  const versionCode =
    versionCodeRaw != null && versionCodeRaw !== ""
      ? Number.parseInt(versionCodeRaw, 10)
      : NaN;

  if (Number.isFinite(versionCode) && versionCode > 0) {
    try {
      await recordDriverAppVersion(auth.driverId, versionCode, versionName);
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        const message = error instanceof Error ? error.message : "driver_record_app_version";
        console.warn("driver_record_app_version", message);
      }
    }
  }

  return NextResponse.json(null);
}

export const GET = withCors(handler);
export const OPTIONS = withCors(async () => new Response(null, { status: 204 }));
