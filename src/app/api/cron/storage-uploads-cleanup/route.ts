import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { markExpiredPendingUploads } from "@/lib/storage/storage-upload-audit";

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
    "storage-uploads-cleanup",
    async () => {
      try {
        const result = await markExpiredPendingUploads();
        return NextResponse.json({ ok: true, ...result });
      } catch (e) {
        Sentry.captureException(e);
        const message = e instanceof Error ? e.message : "cleanup_failed";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    },
    {
      schedule: { type: "crontab", value: "0 4 * * *" },
      checkinMargin: 5,
      maxRuntime: 10,
    },
  );
}
