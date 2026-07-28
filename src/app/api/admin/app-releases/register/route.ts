import { NextResponse } from "next/server";
import { requireReleasesManagerApi } from "@/lib/auth/require-releases-manager";
import { registerAppReleaseRecord } from "@/features/app-releases/app-releases-actions";

export async function POST(request: Request): Promise<Response> {
  const auth = await requireReleasesManagerApi();
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const result = await registerAppReleaseRecord(body as Record<string, unknown>);
  if (!result.ok) {
    const status =
      result.error === "not_authorized"
        ? 403
        : result.error === "not_found" || result.error === "apk_not_found"
          ? 404
          : 400;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  return NextResponse.json({ ok: true, release: result.release });
}
