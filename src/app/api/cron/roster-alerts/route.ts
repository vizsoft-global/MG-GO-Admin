import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { kuwaitToday } from "@/features/driver-tracking/kuwait-time";
import { sweepRosterDay } from "@/features/roster/roster-data";
import { staffDb } from "@/lib/firebase/staff-db";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!secret || bearer !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return Sentry.withMonitor(
    "roster-alerts",
    async () => {
      try {
        const db = await staffDb();
        if (!db) return NextResponse.json({ error: "not_configured" }, { status: 500 });
        await sweepRosterDay(db, kuwaitToday());
        return NextResponse.json({ ok: true });
      } catch (error) {
        Sentry.captureException(error);
        const message = error instanceof Error ? error.message : "roster_alerts_failed";
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
