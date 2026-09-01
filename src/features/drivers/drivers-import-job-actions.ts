"use server";

import { createClient } from "@/lib/supabase/server";
import { listCustomFieldDefinitions } from "@/features/custom-fields/custom-fields-actions";
import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import type { Json } from "@/types/database";
import {
  applyOneImportRow,
  requireDriversManager,
} from "./drivers-import-actions";
import { importChunkSize } from "./import/import-progress";
import type { DriverImportLogEvent } from "./import/import-progress";
import {
  IMPORT_JOB_STALE_MS,
  nextImportJobStatus,
  type ImportJobAction,
  type ImportJobStatus,
} from "./import/import-job";
import type {
  DriverImportJobDetail,
  DriverImportJobSummary,
} from "./import/import-job-types";
import type { DriverImportCredential, DriverImportPreviewRow } from "./types";

const MAX_EVENTS = 2000;

function asStatus(value: string): ImportJobStatus {
  return value as ImportJobStatus;
}

function mapSummary(row: {
  id: string;
  file_name: string;
  status: string;
  row_count: number;
  ready_count: number;
  remaining_count: number;
  applied_count: number;
  skipped_count: number;
  approved_count: number;
  failed_count: number;
  uploaded_at: string;
  heartbeat_at: string | null;
  duplicate_strategy: string;
  approve_immediately: boolean;
}): DriverImportJobSummary {
  return {
    id: row.id,
    fileName: row.file_name,
    status: asStatus(row.status),
    rowCount: row.row_count,
    readyCount: row.ready_count,
    remainingCount: row.remaining_count,
    appliedCount: row.applied_count,
    skippedCount: row.skipped_count,
    approvedCount: row.approved_count,
    failedCount: row.failed_count,
    uploadedAt: row.uploaded_at,
    heartbeatAt: row.heartbeat_at,
    duplicateStrategy: row.duplicate_strategy === "skip" ? "skip" : "update",
    approveImmediately: row.approve_immediately,
  };
}

async function pauseStaleJobs(
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  const staleBefore = new Date(Date.now() - IMPORT_JOB_STALE_MS).toISOString();
  await supabase
    .from("driver_import_batches")
    .update({ status: "paused" })
    .eq("status", "running")
    .or(`heartbeat_at.is.null,heartbeat_at.lt.${staleBefore}`);
}

export async function listDriverImportJobs(): Promise<
  { jobs: DriverImportJobSummary[] } | { error: string }
> {
  const auth = await requireDriversManager();
  if (auth.error) return { error: auth.error };
  const supabase = await createClient();
  await pauseStaleJobs(supabase);
  const { data, error } = await supabase
    .from("driver_import_batches")
    .select(
      "id, file_name, status, row_count, ready_count, remaining_count, applied_count, skipped_count, approved_count, failed_count, uploaded_at, heartbeat_at, duplicate_strategy, approve_immediately",
    )
    .order("uploaded_at", { ascending: false })
    .limit(30);
  if (error) return { error: "save_failed" };
  return { jobs: (data ?? []).map(mapSummary) };
}

export async function getDriverImportJob(
  jobId: string,
): Promise<{ job: DriverImportJobDetail } | { error: string }> {
  const auth = await requireDriversManager();
  if (auth.error) return { error: auth.error };
  if (!jobId) return { error: "missing_fields" };
  const supabase = await createClient();
  await pauseStaleJobs(supabase);
  const { data, error } = await supabase
    .from("driver_import_batches")
    .select(
      "id, file_name, status, row_count, ready_count, remaining_count, applied_count, skipped_count, approved_count, failed_count, uploaded_at, heartbeat_at, duplicate_strategy, approve_immediately, events, credentials, failures, remaining_rows",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (error || !data) return { error: "save_failed" };
  return {
    job: {
      ...mapSummary(data),
      events: (data.events as DriverImportLogEvent[] | null) ?? [],
      credentials: (data.credentials as DriverImportCredential[] | null) ?? [],
      failures:
        (data.failures as Array<{ rowIndex: number; reason: string }> | null) ?? [],
      remainingRows: (data.remaining_rows as DriverImportPreviewRow[] | null) ?? [],
    },
  };
}

export async function startDriverImportJob(payload: {
  fileName: string;
  mapping: Record<string, string>;
  rows: DriverImportPreviewRow[];
  duplicateStrategy: "skip" | "update";
  approveImmediately: boolean;
}): Promise<{ job: DriverImportJobSummary } | { error: string }> {
  const auth = await requireDriversManager();
  if (auth.error) return { error: auth.error };

  const supabase = await createClient();
  await pauseStaleJobs(supabase);

  const { data: blocking } = await supabase
    .from("driver_import_batches")
    .select("id")
    .eq("status", "running")
    .limit(1)
    .maybeSingle();
  if (blocking) return { error: "import_already_running" };

  const ready = payload.rows;
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("driver_import_batches")
    .insert({
      file_name: payload.fileName,
      mapping: payload.mapping as unknown as Json,
      row_count: ready.length,
      ready_count: ready.length,
      remaining_rows: ready as unknown as Json,
      remaining_count: ready.length,
      applied_count: 0,
      skipped_count: 0,
      approved_count: 0,
      failed_count: 0,
      events: [
        {
          at: now,
          kind: "created",
          rowIndex: -1,
          name: payload.fileName || "sheet",
          detail: `${ready.length} ready  approve=${payload.approveImmediately ? "on" : "off"}`,
        },
      ] as unknown as Json,
      credentials: [] as unknown as Json,
      failures: [] as unknown as Json,
      duplicate_strategy: payload.duplicateStrategy,
      approve_immediately: payload.approveImmediately,
      status: "running",
      uploaded_by: auth.session.id,
      heartbeat_at: now,
    })
    .select(
      "id, file_name, status, row_count, ready_count, remaining_count, applied_count, skipped_count, approved_count, failed_count, uploaded_at, heartbeat_at, duplicate_strategy, approve_immediately",
    )
    .single();

  if (error || !data) return { error: "save_failed" };
  return { job: mapSummary(data) };
}

export async function processDriverImportChunk(
  jobId: string,
): Promise<
  | {
      job: DriverImportJobSummary;
      events: DriverImportLogEvent[];
      done: boolean;
      stopped: boolean;
    }
  | { error: string }
> {
  const auth = await requireDriversManager();
  if (auth.error) return { error: auth.error };
  if (!jobId) return { error: "missing_fields" };

  const supabase = await createClient();
  const { data: batch, error: loadError } = await supabase
    .from("driver_import_batches")
    .select(
      "id, status, remaining_count, ready_count, approve_immediately, duplicate_strategy, applied_count, skipped_count, approved_count, failed_count, events, credentials, failures, file_name",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (loadError || !batch) return { error: "save_failed" };

  if (batch.status !== "running") {
    const latest = await getDriverImportJob(jobId);
    if ("error" in latest) return latest;
    return {
      job: latest.job,
      events: [],
      done: latest.job.status === "applied" || latest.job.status === "failed",
      stopped: true,
    };
  }

  const size = importChunkSize(
    Array.from({ length: Math.max(1, batch.remaining_count) }, () => ({
      active: null,
    })),
    batch.approve_immediately,
  );

  const { data: claimed, error: claimError } = await supabase.rpc(
    "claim_driver_import_chunk",
    { p_id: jobId, p_size: size },
  );
  if (claimError) return { error: claimError.message };

  if (claimed === null) {
    const latest = await getDriverImportJob(jobId);
    if ("error" in latest) return latest;
    return {
      job: latest.job,
      events: [],
      done: latest.job.status === "applied" || latest.job.status === "failed",
      stopped: true,
    };
  }

  const rows = (claimed as DriverImportPreviewRow[] | null) ?? [];
  if (rows.length === 0) {
    const applied = batch.applied_count;
    const nextStatus = applied > 0 ? "applied" : "failed";
    await supabase
      .from("driver_import_batches")
      .update({ status: nextStatus, remaining_count: 0, remaining_rows: [] })
      .eq("id", jobId);
    void logAdminMutation({
      action: "create",
      entityType: "driver_import_batch",
      entityId: jobId,
      routeName: "processDriverImportChunk",
      after: {
        applied: batch.applied_count,
        approved: batch.approved_count,
        skipped: batch.skipped_count,
        failures: batch.failed_count,
      },
    });
    const latest = await getDriverImportJob(jobId);
    if ("error" in latest) return latest;
    return {
      job: latest.job,
      events: [],
      done: true,
      stopped: false,
    };
  }

  const customFieldDefs = await listCustomFieldDefinitions("driver");
  const events: DriverImportLogEvent[] = [];
  const failures: Array<{ rowIndex: number; reason: string }> = [];
  const credentials: DriverImportCredential[] = [];
  let applied = 0;
  let approved = 0;
  let skipped = 0;

  for (const row of rows) {
    const result = await applyOneImportRow(row, {
      supabase,
      duplicateStrategy: batch.duplicate_strategy === "skip" ? "skip" : "update",
      approveImmediately: batch.approve_immediately,
      customFieldDefs,
      fileName: batch.file_name,
    });
    events.push(...result.events);
    applied += result.applied;
    approved += result.approved;
    if (result.credential) credentials.push(result.credential);
    if (result.failure) {
      failures.push(result.failure);
      if (result.applied === 0) skipped += 1;
    }
  }

  const priorEvents = (batch.events as DriverImportLogEvent[] | null) ?? [];
  const priorCredentials = (batch.credentials as DriverImportCredential[] | null) ?? [];
  const priorFailures =
    (batch.failures as Array<{ rowIndex: number; reason: string }> | null) ?? [];
  const nextEvents = [...priorEvents, ...events].slice(-MAX_EVENTS);

  const { data: afterClaim } = await supabase
    .from("driver_import_batches")
    .select("remaining_count, status")
    .eq("id", jobId)
    .maybeSingle();

  const remaining = afterClaim?.remaining_count ?? 0;
  const stillRunning = afterClaim?.status === "running";
  const finished = stillRunning && remaining === 0;
  const nextStatus = finished
    ? applied + batch.applied_count > 0
      ? "applied"
      : "failed"
    : undefined;

  await supabase
    .from("driver_import_batches")
    .update({
      applied_count: batch.applied_count + applied,
      skipped_count: batch.skipped_count + skipped,
      approved_count: batch.approved_count + approved,
      failed_count: batch.failed_count + failures.length,
      events: nextEvents as unknown as Json,
      credentials: [...priorCredentials, ...credentials] as unknown as Json,
      failures: [...priorFailures, ...failures] as unknown as Json,
      heartbeat_at: new Date().toISOString(),
      ...(nextStatus ? { status: nextStatus } : {}),
    })
    .eq("id", jobId);

  if (finished) {
    void logAdminMutation({
      action: "create",
      entityType: "driver_import_batch",
      entityId: jobId,
      routeName: "processDriverImportChunk",
      after: {
        applied: batch.applied_count + applied,
        approved: batch.approved_count + approved,
        skipped: batch.skipped_count + skipped,
        failures: batch.failed_count + failures.length,
      },
    });
  }

  const latest = await getDriverImportJob(jobId);
  if ("error" in latest) return latest;
  return {
    job: latest.job,
    events,
    done: latest.job.status === "applied" || latest.job.status === "failed",
    stopped: latest.job.status !== "running" && !finished,
  };
}

export async function setDriverImportJobStatus(
  jobId: string,
  action: ImportJobAction,
): Promise<{ job: DriverImportJobSummary } | { error: string }> {
  const auth = await requireDriversManager();
  if (auth.error) return { error: auth.error };
  if (!jobId) return { error: "missing_fields" };
  if (action !== "pause" && action !== "resume" && action !== "cancel") {
    return { error: "save_failed" };
  }

  const supabase = await createClient();
  await pauseStaleJobs(supabase);
  const { data: batch, error } = await supabase
    .from("driver_import_batches")
    .select(
      "id, file_name, status, row_count, ready_count, remaining_count, applied_count, skipped_count, approved_count, failed_count, uploaded_at, heartbeat_at, duplicate_strategy, approve_immediately",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (error || !batch) return { error: "save_failed" };

  const next = nextImportJobStatus(asStatus(batch.status), action);
  if (!next) return { error: "import_job_locked" };

  if (action === "resume") {
    const { data: blocking } = await supabase
      .from("driver_import_batches")
      .select("id")
      .eq("status", "running")
      .neq("id", jobId)
      .limit(1)
      .maybeSingle();
    if (blocking) return { error: "import_already_running" };
  }

  const { data: updated, error: updError } = await supabase
    .from("driver_import_batches")
    .update({
      status: next,
      heartbeat_at: new Date().toISOString(),
      ...(action === "cancel"
        ? { remaining_rows: [] as unknown as Json, remaining_count: 0 }
        : {}),
    })
    .eq("id", jobId)
    .select(
      "id, file_name, status, row_count, ready_count, remaining_count, applied_count, skipped_count, approved_count, failed_count, uploaded_at, heartbeat_at, duplicate_strategy, approve_immediately",
    )
    .single();
  if (updError || !updated) return { error: "save_failed" };
  return { job: mapSummary(updated) };
}
