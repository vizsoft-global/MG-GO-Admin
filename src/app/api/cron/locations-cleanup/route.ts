import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { cleanupStaleDriverLocations } from "@/features/locations/locations-actions";

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
    "locations-cleanup",
    async () => {
      try {
        const deleted = await cleanupStaleDriverLocations();
        return NextResponse.json({ ok: true, deleted });
      } catch (e) {
        Sentry.captureException(e);
        const message = e instanceof Error ? e.message : "cleanup_failed";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    },
    {
      // Hourly. This only removes the pins of archived or deleted drivers, which
      // nothing waits on; every two minutes it re-read up to 500 kept pins and
      // their driver documents 720 times a day to delete almost nothing.
      schedule: { type: "crontab", value: "7 * * * *" },
      checkinMargin: 10,
      maxRuntime: 3,
    },
  );
}
