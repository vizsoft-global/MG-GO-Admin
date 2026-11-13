import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { isUsageRangeKey, loadUsageRange } from "@/features/usage-monitor/usage-range";

/**
 * Read-only usage for the standalone monitor.
 *
 * The monitor is a separate site with none of this project's keys. It asks here
 * with a shared secret (`USAGE_MONITOR_KEY`), and gets usage counters only —
 * no document, no rider data. With the secret unset the route does not exist.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(request: Request): boolean {
  const expected = process.env.USAGE_MONITOR_KEY?.trim();
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!given) return false;
  // Compared as digests so the lengths always match and the timing says nothing.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request): Promise<Response> {
  if (!process.env.USAGE_MONITOR_KEY?.trim()) {
    return NextResponse.json({ error: "not_configured" }, { status: 404 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const range = new URL(request.url).searchParams.get("range");
  if (!isUsageRangeKey(range)) {
    return NextResponse.json({ error: "invalid_range" }, { status: 400 });
  }

  try {
    const payload = await loadUsageRange(range);
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "usage_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
