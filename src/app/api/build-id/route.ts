import { NextResponse } from "next/server";
import { resolveLiveBuildId } from "@/lib/app/build-id";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const buildId = resolveLiveBuildId();

  return NextResponse.json(
    { buildId },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "CDN-Cache-Control": "no-store",
        "Vercel-CDN-Cache-Control": "no-store",
      },
    },
  );
}
