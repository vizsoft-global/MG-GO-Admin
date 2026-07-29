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
    "attendance-auto-checkout",
    async () => {
      try {
        const supabase = createAdminClient();
        const { data, error } = await supabase.rpc("admin_run_attendance_auto_checkout");
        if (error) throw error;
        return NextResponse.json({ ok: true, checkedOut: data ?? 0 });
      } catch (e) {
        Sentry.captureException(e);
        const message = e instanceof Error ? e.message : "auto_checkout_failed";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    },
    {
      schedule: { type: "crontab", value: "*/5 * * * *" },
      checkinMargin: 2,
      maxRuntime: 5,
    },
  );
}
