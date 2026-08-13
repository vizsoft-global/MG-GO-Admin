import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { runDriverOpsRetention } from "@/features/live-tracking/operations-retention-actions";

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
    "driver-ops-retention",
    async () => {
      try {
        const result = await runDriverOpsRetention();

        // The autonomous emitter swallows its own errors by design, so a broken
        // dblink path is only ever visible here.
        if (!result.auditHealth.reachable) {
          Sentry.captureMessage(
            `driver ops autonomous audit unreachable: ${result.auditHealth.reason ?? "unknown"}`,
            "warning",
          );
        }

        return NextResponse.json({ ok: true, ...result });
      } catch (e) {
        Sentry.captureException(e);
        const message = e instanceof Error ? e.message : "retention_failed";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    },
    {
      schedule: { type: "crontab", value: "20 1 * * *" },
      checkinMargin: 10,
      maxRuntime: 10,
    },
  );
}
