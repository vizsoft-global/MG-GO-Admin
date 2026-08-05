import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  if (!secret || bearer !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return Sentry.withMonitor(
    "expire-stale-pickups",
    async () => {
      try {
        const supabase = createAdminClient();
        const { data, error } = await supabase.rpc("admin_expire_stale_pickups");
        if (error) throw error;
        return NextResponse.json({ ok: true, expired: data ?? 0 });
      } catch (e) {
        Sentry.captureException(e);
        const message = e instanceof Error ? e.message : "expire_pickups_failed";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    },
    {
      schedule: { type: "crontab", value: "*/15 * * * *" },
      checkinMargin: 5,
      maxRuntime: 5,
    },
  );
}
