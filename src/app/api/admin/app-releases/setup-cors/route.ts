import { NextResponse } from "next/server";

/** Sideload / in-app APK OTA permanently removed (Play Store policy). */
export async function POST(): Promise<Response> {
  return NextResponse.json(
    {
      ok: false,
      error: "sideload_removed",
      message:
        "In-app APK publishing is disabled. Ship driver app updates via Google Play only.",
    },
    { status: 410 },
  );
}

export async function GET(): Promise<Response> {
  return POST();
}
