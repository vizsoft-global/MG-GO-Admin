import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { processDueAutomations } from "@/features/notifications/notifications-actions";

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
    "notifications-automations",
    async () => {
      try {
        const result = await processDueAutomations();
        return NextResponse.json({ ok: true, ...result });
      } catch (e) {
        Sentry.captureException(e);
        const message = e instanceof Error ? e.message : "automation_failed";
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
