import { NextResponse } from "next/server";
import { requireReleasesManagerApi } from "@/lib/auth/require-releases-manager";
import { applyBucketCors } from "@/lib/storage/r2-client";
import { isR2Configured } from "@/lib/storage/r2-config";

const DEFAULT_ORIGINS = [
  "https://dpdadmin.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
];

export async function POST(request: Request): Promise<Response> {
  const auth = await requireReleasesManagerApi();
  if ("error" in auth) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 403 });
  }

  if (!(await isR2Configured())) {
    return NextResponse.json({ ok: false, error: "r2_not_configured" }, { status: 503 });
  }

  let extraOrigins: string[] = [];
  try {
    const body = (await request.json().catch(() => ({}))) as {
      origins?: unknown;
    };
    if (Array.isArray(body.origins)) {
      extraOrigins = body.origins
        .map((origin) => String(origin).trim())
        .filter((origin) => origin.length > 0);
    }
  } catch {
    /* body is optional */
  }

  const origins = Array.from(new Set([...DEFAULT_ORIGINS, ...extraOrigins]));

  try {
    await applyBucketCors(origins);
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("apply cors failed", error);
    }
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json(
      { ok: false, error: "cors_apply_failed", details: message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, appliedOrigins: origins });
}
