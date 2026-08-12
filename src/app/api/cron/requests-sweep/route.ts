import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";

/** Auto-close of decided requests and SLA breach flagging share one hourly pass. */
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
    "requests-sweep",
    async () => {
      try {
        const supabase = createAdminClient();
        const [closed, breached] = await Promise.all([
          supabase.rpc("admin_auto_close_requests"),
          supabase.rpc("admin_run_request_sla_sweep"),
        ]);
        if (closed.error) throw closed.error;
        if (breached.error) throw breached.error;
        return NextResponse.json({
          ok: true,
          closed: closed.data ?? 0,
          slaBreached: breached.data ?? 0,
        });
      } catch (e) {
        Sentry.captureException(e);
        const message = e instanceof Error ? e.message : "requests_sweep_failed";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    },
    {
      schedule: { type: "crontab", value: "0 * * * *" },
      checkinMargin: 10,
      maxRuntime: 5,
    },
  );
}
