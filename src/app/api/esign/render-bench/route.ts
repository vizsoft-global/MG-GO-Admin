import { NextResponse } from "next/server";
import { runEsignRenderBench } from "@/features/esign/render/esign-render-bench";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;
  if (!bearer) return false;
  const secrets = [process.env.CRON_SECRET, process.env.ESIGN_BENCH_SECRET]
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s));
  return secrets.includes(bearer);
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { report } = await runEsignRenderBench("vercel");
    return NextResponse.json(report);
  } catch (e) {
    const message = e instanceof Error ? e.message : "esign_render_bench_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
