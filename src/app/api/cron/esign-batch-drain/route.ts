import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeEsignBatchDrain } from "@/features/esign/esign-batch-drain-auth";
import { runEsignBatchChunk } from "@/features/esign/esign-sender-actions";

const BATCH_CAP = 3;

export async function GET(request: Request): Promise<Response> {
  if (!authorizeEsignBatchDrain(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return Sentry.withMonitor(
    "esign-batch-drain",
    async () => {
      try {
        const supabase = createAdminClient() as any;
        const listed = await supabase.rpc("esign_worker_drainable_batches", {
          p_limit: BATCH_CAP,
        });
        if (listed.error) throw listed.error;
        const payload =
          listed.data && typeof listed.data === "object"
            ? (listed.data as { ok?: boolean; rows?: unknown })
            : {};
        const raw = Array.isArray(payload.rows) ? payload.rows : [];
        const batches = raw
          .map((row) => {
            const r = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
            return {
              batchId: String(r.batch_id ?? ""),
              actorId: r.created_by != null ? String(r.created_by) : null,
            };
          })
          .filter((row) => row.batchId);

        const results = [];
        for (const batch of batches) {
          const chunk = await runEsignBatchChunk({
            supabase,
            batchId: batch.batchId,
            mode: "pending",
            asWorker: true,
            actorId: batch.actorId,
          });
          results.push({ batchId: batch.batchId, ...chunk });
        }

        return NextResponse.json({
          ok: true,
          drained: results.length,
          results,
        });
      } catch (e) {
        Sentry.captureException(e);
        const message = e instanceof Error ? e.message : "esign_batch_drain_failed";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    },
    {
      schedule: { type: "crontab", value: "*/5 * * * *" },
      checkinMargin: 10,
      maxRuntime: 5,
    },
  );
}
