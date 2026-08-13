import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { runDriverTelemetryRetention } from "@/features/live-tracking/telemetry-retention-actions";

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
    "driver-telemetry-retention",
    async () => {
      try {
        const result = await runDriverTelemetryRetention();
        return NextResponse.json({ ok: true, ...result });
      } catch (e) {
        Sentry.captureException(e);
        const message = e instanceof Error ? e.message : "retention_failed";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    },
    {
      // 20 minutes after the driver-ops run, so the two batched deletes never
      // contend for the same window.
      schedule: { type: "crontab", value: "40 1 * * *" },
      checkinMargin: 10,
      maxRuntime: 10,
    },
  );
}
