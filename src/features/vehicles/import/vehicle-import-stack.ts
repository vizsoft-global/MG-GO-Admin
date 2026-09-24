export type VehicleImportBatchTip = {
  id: string;
  status: "applied" | "undone";
  createdAt: string;
  undoSeq: number | null;
  redoable: boolean;
};

/** Latest applied batch. A newer import stays applied, so it is the only undo target. */
export function undoTargetId(batches: readonly VehicleImportBatchTip[]): string | null {
  const applied = batches.filter((batch) => batch.status === "applied");
  if (!applied.length) return null;
  return [...applied].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]?.id ?? null;
}

/** Newest undone batch that a later import has not invalidated. */
export function redoTargetId(batches: readonly VehicleImportBatchTip[]): string | null {
  const undone = batches.filter(
    (batch) => batch.status === "undone" && batch.redoable && batch.undoSeq != null,
  );
  if (!undone.length) return null;
  return [...undone].sort((a, b) => (b.undoSeq ?? 0) - (a.undoSeq ?? 0))[0]?.id ?? null;
}

export function nextUndoSeq(batches: readonly VehicleImportBatchTip[]): number {
  return batches.reduce((max, batch) => Math.max(max, batch.undoSeq ?? 0), 0) + 1;
}

export function undoRowPlan(row: {
  outcome: "create" | "update" | "failed";
  vehicleId: string | null;
  before: unknown;
}): { op: "delete"; vehicleId: string } | { op: "restore"; vehicleId: string; snapshot: unknown } | null {
  if (row.outcome === "failed" || !row.vehicleId) return null;
  if (row.outcome === "create") return { op: "delete", vehicleId: row.vehicleId };
  if (row.before == null) return null;
  return { op: "restore", vehicleId: row.vehicleId, snapshot: row.before };
}

export function redoRowPlan(row: {
  outcome: "create" | "update" | "failed";
  vehicleId: string | null;
  after: unknown;
}): { op: "write"; vehicleId: string | null; snapshot: unknown } | null {
  if (row.outcome === "failed" || row.after == null) return null;
  return { op: "write", vehicleId: row.vehicleId, snapshot: row.after };
}

/** A new Apply drops every undone batch off the redo stack. */
export function clearRedo<T extends VehicleImportBatchTip>(batches: readonly T[]): T[] {
  return batches.map((batch) =>
    batch.status === "undone" ? { ...batch, redoable: false } : batch,
  );
}
