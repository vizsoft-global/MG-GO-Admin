"use server";

import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { staffClient, type StaffClient } from "./driver-uniqueness";
import { listCustomFieldDefinitions } from "@/features/custom-fields/custom-fields-actions";
import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import type { Json } from "@/types/database";
import {
  applyOneImportRow,
  loadImportMatches,
  requireDriversManager,
} from "./drivers-import-actions";
import {
  IMPORT_APPLY_CONCURRENCY,
  importChunkSize,
  mapWithConcurrency,
  type DriverImportLogEvent,
} from "./import/import-progress";
import { pendingRowDocId, storedImportRow } from "./import/import-job-rows";
import {
  IMPORT_HEARTBEAT_MS,
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
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";

const MAX_EVENTS = 2000;
const PENDING_BATCH = 400;
const JOB_SUMMARY_COLUMNS =
  "id, file_name, status, row_count, ready_count, remaining_count, applied_count, skipped_count, approved_count, failed_count, uploaded_at, heartbeat_at, duplicate_strategy, approve_immediately, sealed";

function ownsImport(uploadedBy: unknown, userId: string): boolean {
  return typeof uploadedBy === "string" && uploadedBy.length > 0 && uploadedBy === userId;
}

function pendingRef(fs: Firestore, jobId: string) {
  const parent = fs.collection(COLLECTIONS.driverImportBatches).doc(jobId);
  return { parent, col: parent.collection("pending") };
}

async function writePendingRows(
  jobId: string,
  rows: readonly DriverImportPreviewRow[],
  offset: number,
): Promise<string | null> {
  const fs = await staffDb();
  if (!fs) return "save_failed";
  const { col } = pendingRef(fs, jobId);
  for (let i = 0; i < rows.length; i += PENDING_BATCH) {
    const batch = fs.batch();
    const slice = rows.slice(i, i + PENDING_BATCH);
    slice.forEach((row, j) => {
      batch.set(col.doc(pendingRowDocId(offset + i + j)), { row: storedImportRow(row) });
    });
    try {
      await batch.commit();
    } catch {
      return "save_failed";
    }
  }
  return null;
}

async function deletePendingRows(jobId: string): Promise<void> {
  const fs = await staffDb();
  if (!fs) return;
  const { col } = pendingRef(fs, jobId);
  for (;;) {
    const snap = await col.limit(PENDING_BATCH).get();
    if (snap.empty) return;
    const batch = fs.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
  }
}

async function claimPendingRows(
  jobId: string,
  size: number,
): Promise<{ rows: DriverImportPreviewRow[] } | { error: string } | { stopped: true }> {
  const fs = await staffDb();
  if (!fs) return { error: "save_failed" };
  const { parent, col } = pendingRef(fs, jobId);
  try {
    return await fs.runTransaction(async (tx) => {
      const snap = await tx.get(parent);
      if (!snap.exists) return { stopped: true };
      const data = snap.data() ?? {};
      if (data.status !== "running") return { stopped: true };
      const pending = await tx.get(col.orderBy(FieldPath.documentId()).limit(size));
      if (pending.empty) return { rows: [] };
      const rows: DriverImportPreviewRow[] = [];
      for (const doc of pending.docs) {
        const row = doc.get("row");
        if (row && typeof row === "object") rows.push(row as DriverImportPreviewRow);
        tx.delete(doc.ref);
      }
      const remaining = Math.max(0, Number(data.remaining_count ?? 0) - pending.size);
      tx.update(parent, {
        remaining_count: remaining,
        heartbeat_at: new Date().toISOString(),
      });
      return { rows };
    });
  } catch {
    return { error: "save_failed" };
  }
}

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
  sealed?: boolean;
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
    sealed: row.sealed !== false,
  };
}

async function beatImportJob(db: StaffClient, jobId: string): Promise<void> {
  try {
    await db
      .from("driver_import_batches")
      .update({ heartbeat_at: new Date().toISOString() })
      .eq("id", jobId)
      .eq("status", "running");
  } catch {
    return;
  }
}

async function pauseStaleJobs(
  db: StaffClient,
) {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) throw new Error(mutationAuth.error);
  const staleBefore = new Date(Date.now() - IMPORT_JOB_STALE_MS).toISOString();
  await db
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
  const db = await staffClient();
  await pauseStaleJobs(db);
  const { data, error } = await db
    .from("driver_import_batches")
    .select(`${JOB_SUMMARY_COLUMNS}, uploaded_by`)
    .order("uploaded_at", { ascending: false })
    .limit(30);
  if (error) return { error: "save_failed" };
  const mine = (data ?? []).filter((row) =>
    ownsImport((row as { uploaded_by?: unknown }).uploaded_by, auth.session.id),
  );
  return { jobs: mine.map(mapSummary) };
}

export async function getDriverImportJob(
  jobId: string,
): Promise<{ job: DriverImportJobDetail } | { error: string }> {
  const auth = await requireDriversManager();
  if (auth.error) return { error: auth.error };
  if (!jobId) return { error: "missing_fields" };
  const db = await staffClient();
  await pauseStaleJobs(db);
  const { data, error } = await db
    .from("driver_import_batches")
    .select(`${JOB_SUMMARY_COLUMNS}, uploaded_by, events, credentials, failures, remaining_rows`)
    .eq("id", jobId)
    .maybeSingle();
  if (error || !data) return { error: "save_failed" };
  if (!ownsImport((data as { uploaded_by?: unknown }).uploaded_by, auth.session.id)) {
    return { error: "not_authorized" };
  }
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

async function discardImportJob(jobId: string): Promise<void> {
  await deletePendingRows(jobId);
  const fs = await staffDb();
  if (!fs) return;
  await fs.collection(COLLECTIONS.driverImportBatches).doc(jobId).delete();
}

export async function startDriverImportJob(payload: {
  fileName: string;
  mapping: Record<string, string>;
  rows: DriverImportPreviewRow[];
  duplicateStrategy: "skip" | "update";
  approveImmediately: boolean;
  /** False when another slice of the same sheet still has to be stored. */
  seal?: boolean;
}): Promise<{ job: DriverImportJobSummary } | { error: string }> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireDriversManager("create");
  if (auth.error) return { error: auth.error };

  const db = await staffClient();
  await pauseStaleJobs(db);

  const { data: blocking } = await db
    .from("driver_import_batches")
    .select("id")
    .eq("status", "running")
    .limit(1)
    .maybeSingle();
  if (blocking) return { error: "import_already_running" };

  const ready = payload.rows;
  const seal = payload.seal !== false;
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("driver_import_batches")
    .insert({
      id: crypto.randomUUID(),
      file_name: payload.fileName,
      mapping: payload.mapping as unknown as Json,
      row_count: ready.length,
      ready_count: ready.length,
      remaining_rows: [] as unknown as Json,
      pending_store: "sub",
      sealed: seal,
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
      JOB_SUMMARY_COLUMNS,
    )
    .single();

  if (error || !data) return { error: "save_failed" };
  const writeError = await writePendingRows(data.id, ready, 0);
  if (writeError) {
    await discardImportJob(data.id);
    return { error: "save_failed" };
  }
  return { job: mapSummary(data) };
}

export async function appendDriverImportRows(payload: {
  jobId: string;
  rows: DriverImportPreviewRow[];
  offset: number;
  seal: boolean;
}): Promise<{ ok: true } | { error: string }> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireDriversManager("create");
  if (auth.error) return { error: auth.error };
  if (!payload.jobId) return { error: "missing_fields" };

  const db = await staffClient();
  const { data: batch, error } = await db
    .from("driver_import_batches")
    .select("id, status, sealed, pending_store, row_count, ready_count, remaining_count, uploaded_by")
    .eq("id", payload.jobId)
    .maybeSingle();
  if (error || !batch) return { error: "save_failed" };
  if (!ownsImport((batch as { uploaded_by?: unknown }).uploaded_by, auth.session.id)) {
    return { error: "not_authorized" };
  }
  const stored = batch as typeof batch & {
    status?: string;
    sealed?: boolean;
    pending_store?: string;
    row_count?: number;
    ready_count?: number;
    remaining_count?: number;
  };
  if (stored.status !== "running" || stored.pending_store !== "sub" || stored.sealed === true) {
    return { error: "save_failed" };
  }
  const writeError = await writePendingRows(payload.jobId, payload.rows, payload.offset);
  if (writeError) {
    await deletePendingRows(payload.jobId);
    await db
      .from("driver_import_batches")
      .update({ status: "failed", remaining_count: 0, remaining_rows: [], sealed: true })
      .eq("id", payload.jobId);
    return { error: "save_failed" };
  }
  const add = payload.rows.length;
  const { error: updError } = await db
    .from("driver_import_batches")
    .update({
      row_count: Number(stored.row_count ?? 0) + add,
      ready_count: Number(stored.ready_count ?? 0) + add,
      remaining_count: Number(stored.remaining_count ?? 0) + add,
      sealed: payload.seal,
      heartbeat_at: new Date().toISOString(),
    })
    .eq("id", payload.jobId);
  if (updError) return { error: "save_failed" };
  return { ok: true };
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
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireDriversManager("create");
  if (auth.error) return { error: auth.error };
  if (!jobId) return { error: "missing_fields" };

  const db = await staffClient();
  const { data: batch, error: loadError } = await db
    .from("driver_import_batches")
    .select(
      "id, status, remaining_count, ready_count, approve_immediately, duplicate_strategy, applied_count, skipped_count, approved_count, failed_count, events, credentials, failures, file_name, pending_store, sealed, uploaded_by",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (loadError || !batch) return { error: "save_failed" };
  if (!ownsImport((batch as { uploaded_by?: unknown }).uploaded_by, auth.session.id)) {
    return { error: "not_authorized" };
  }

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

  await beatImportJob(db, jobId);
  const heart = setInterval(() => {
    void beatImportJob(db, jobId);
  }, IMPORT_HEARTBEAT_MS);

  try {
  const stored = batch as typeof batch & { pending_store?: string | null; sealed?: boolean | null };
  if (stored.pending_store === "sub" && stored.sealed !== true) {
    const latest = await getDriverImportJob(jobId);
    if ("error" in latest) return latest;
    return { job: latest.job, events: [], done: false, stopped: true };
  }

  const size = importChunkSize(
    Array.from({ length: Math.max(1, batch.remaining_count) }, () => ({
      active: null,
    })),
    batch.approve_immediately,
  );

  let rows: DriverImportPreviewRow[];
  if (stored.pending_store === "sub") {
    const claimed = await claimPendingRows(jobId, size);
    if ("error" in claimed) return { error: claimed.error };
    if ("stopped" in claimed) {
      const latest = await getDriverImportJob(jobId);
      if ("error" in latest) return latest;
      return {
        job: latest.job,
        events: [],
        done: latest.job.status === "applied" || latest.job.status === "failed",
        stopped: true,
      };
    }
    rows = claimed.rows;
  } else {
    const { data: claimed, error: claimError } = await db.rpc(
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
    rows = (claimed as DriverImportPreviewRow[] | null) ?? [];
  }
  if (rows.length === 0) {
    const applied = batch.applied_count;
    const nextStatus = applied > 0 ? "applied" : "failed";
    await db
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
  const loaded = await loadImportMatches(db, rows);
  const events: DriverImportLogEvent[] = [];
  const failures: Array<{ rowIndex: number; reason: string }> = [];
  const credentials: DriverImportCredential[] = [];
  let applied = 0;
  let approved = 0;
  let skipped = 0;

  const results =
    "error" in loaded
      ? rows.map((row) => ({
          events: [
            {
              at: new Date().toISOString(),
              kind: "failed" as const,
              rowIndex: row.rowIndex,
              name: row.full_name?.trim() ?? "",
              employeeId: row.employee_id ?? undefined,
              detail: loaded.error,
            },
          ],
          applied: 0,
          approved: 0,
          credential: undefined,
          failure: { rowIndex: row.rowIndex, reason: loaded.error },
        }))
      : await mapWithConcurrency(rows, IMPORT_APPLY_CONCURRENCY, (row) =>
          applyOneImportRow(row, {
            db,
            duplicateStrategy: batch.duplicate_strategy === "skip" ? "skip" : "update",
            approveImmediately: batch.approve_immediately,
            customFieldDefs,
            fileName: batch.file_name,
            actorId: auth.session.id,
            persistJournal: false,
            matches: loaded.index,
          }),
        );
  for (const result of results) {
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

  const { data: afterClaim } = await db
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

  await db
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
  } finally {
    clearInterval(heart);
  }
}

export async function setDriverImportJobStatus(
  jobId: string,
  action: ImportJobAction,
): Promise<{ job: DriverImportJobSummary } | { error: string }> {
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return { error: mutationAuth.error };
  const auth = await requireDriversManager();
  if (auth.error) return { error: auth.error };
  if (!jobId) return { error: "missing_fields" };
  if (action !== "pause" && action !== "resume" && action !== "cancel") {
    return { error: "save_failed" };
  }

  const db = await staffClient();
  await pauseStaleJobs(db);
  const { data: batch, error } = await db
    .from("driver_import_batches")
    .select(`${JOB_SUMMARY_COLUMNS}, uploaded_by`)
    .eq("id", jobId)
    .maybeSingle();
  if (error || !batch) return { error: "save_failed" };
  if (!ownsImport((batch as { uploaded_by?: unknown }).uploaded_by, auth.session.id)) {
    return { error: "not_authorized" };
  }

  const next = nextImportJobStatus(asStatus(batch.status), action);
  if (!next) return { error: "import_job_locked" };

  if (action === "cancel") await deletePendingRows(jobId);

  if (action === "resume") {
    const { data: blocking } = await db
      .from("driver_import_batches")
      .select("id")
      .eq("status", "running")
      .neq("id", jobId)
      .limit(1)
      .maybeSingle();
    if (blocking) return { error: "import_already_running" };
  }

  const { data: updated, error: updError } = await db
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
      JOB_SUMMARY_COLUMNS,
    )
    .single();
  if (updError || !updated) return { error: "save_failed" };
  return { job: mapSummary(updated) };
}
