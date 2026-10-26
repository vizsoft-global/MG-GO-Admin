export type DriverImportBatchTip = {
  id: string;
  status: string;
  createdAt: string;
  undoSeq: number;
  redoable: boolean;
};

export type DriverImportTrackingSnap = {
  doc_type: string;
  object_key: string | null;
  expires_at: string | null;
  track_expiry: boolean;
};

export type DriverImportSnapshot = {
  intake: Record<string, unknown> | null;
  driver: Record<string, unknown> | null;
  profile: Record<string, unknown> | null;
  restaurant_ids: string[];
  asset_ids: string[];
  tracking: DriverImportTrackingSnap[];
  off_days: number | null;
  driver_code: string | null;
};

export type DriverImportJournal = {
  batch_id: string;
  row_index: number;
  outcome: "create" | "update" | "failed" | "skipped";
  intake_id: string | null;
  driver_id: string | null;
  created_auth_uid: string | null;
  passcode: string | null;
  before: DriverImportSnapshot | null;
  after: DriverImportSnapshot | null;
  replay?: "applied" | "undone" | null;
};

export function effectiveReplay(
  replay: "applied" | "undone" | null | undefined,
  batchStatus: string,
): "applied" | "undone" {
  if (replay === "applied" || replay === "undone") return replay;
  return batchStatus === "undone" ? "undone" : "applied";
}

export function undoTargetId(batches: readonly DriverImportBatchTip[]): string | null {
  const applied = batches.filter((batch) => batch.status === "applied");
  if (applied.length === 0) return null;
  return [...applied].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]!.id;
}

export function redoTargetId(batches: readonly DriverImportBatchTip[]): string | null {
  const undone = batches.filter((batch) => batch.status === "undone" && batch.redoable);
  if (undone.length === 0) return null;
  return [...undone].sort((a, b) => b.undoSeq - a.undoSeq)[0]!.id;
}

export function nextUndoSeq(batches: readonly DriverImportBatchTip[]): number {
  return batches.reduce((max, batch) => Math.max(max, batch.undoSeq), 0) + 1;
}

/** A new Apply retires every undone batch so Redo cannot replay a stale one. */
export function clearRedo(batches: readonly DriverImportBatchTip[]): string[] {
  return batches.filter((batch) => batch.status === "undone" && batch.redoable).map((batch) => batch.id);
}

export function undoRowPlan(
  row: Pick<DriverImportJournal, "outcome" | "intake_id" | "before">,
): "delete" | "restore" | null {
  if (row.outcome === "failed" || row.outcome === "skipped" || !row.intake_id) return null;
  if (row.outcome === "create") return "delete";
  if (!row.before) return null;
  return "restore";
}

export function redoRowPlan(
  row: Pick<DriverImportJournal, "outcome" | "after">,
): "write" | null {
  if (row.outcome === "failed" || row.outcome === "skipped" || !row.after) return null;
  return "write";
}
