import { NextResponse } from "next/server";
import { withCors } from "@/lib/http/cors";
import {
  getFirebaseClientConfig,
  type FirebaseClientPlatform,
} from "@/lib/firebase/client-config";
import { isFirebaseConfigured } from "@/lib/firebase/config";

function parsePlatform(value: string | null): FirebaseClientPlatform | null {
  if (value === "android" || value === "ios" || value === "web") return value;
  return null;
}

async function handler(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const platform = parsePlatform(searchParams.get("platform")?.toLowerCase() ?? null);
  if (!platform) {
    return NextResponse.json(
      { error: "invalid_platform", message: "Use ?platform=android|ios|web" },
      { status: 400 },
    );
  }

  const config = getFirebaseClientConfig(platform);
  if (!config) {
    return NextResponse.json(
      {
        error: "firebase_not_configured",
        message: "Firebase client env vars are missing on the admin deployment.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    platform,
    configured: true,
    serverConfigured: isFirebaseConfigured(),
    config,
    packageName: platform === "android" ? "kw.musallam.delivery" : undefined,
    bundleId: platform === "ios" ? "kw.musallam.delivery" : undefined,
  });
}

export const GET = withCors(handler);
export const OPTIONS = withCors(async () => new Response(null, { status: 204 }));
