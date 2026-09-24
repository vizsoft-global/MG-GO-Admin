export type ReconImportTip = {
  id: string;
  status: "applied" | "undone";
  createdAt: string;
  undoSeq: number | null;
  redoable: boolean;
};

/** Latest applied run. A newer compare stays applied, so it is the only undo target. */
export function undoTargetId(runs: readonly ReconImportTip[]): string | null {
  const applied = runs.filter((run) => run.status === "applied");
  if (!applied.length) return null;
  return [...applied].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]?.id ?? null;
}

/** Newest undone run that a later compare has not invalidated. */
export function redoTargetId(runs: readonly ReconImportTip[]): string | null {
  const undone = runs.filter(
    (run) => run.status === "undone" && run.redoable && run.undoSeq != null,
  );
  if (!undone.length) return null;
  return [...undone].sort((a, b) => (b.undoSeq ?? 0) - (a.undoSeq ?? 0))[0]?.id ?? null;
}

export function nextUndoSeq(runs: readonly ReconImportTip[]): number {
  return runs.reduce((max, run) => Math.max(max, run.undoSeq ?? 0), 0) + 1;
}
