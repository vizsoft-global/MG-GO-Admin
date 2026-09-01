export const IMPORT_JOB_STATUSES = [
  "previewed",
  "running",
  "paused",
  "cancelled",
  "applied",
  "failed",
] as const;

export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

export type ImportJobAction = "pause" | "resume" | "cancel" | "finish" | "fail";

export const IMPORT_JOB_STALE_MS = 90_000;

export function canPauseImportJob(status: ImportJobStatus): boolean {
  return status === "running";
}

export function canResumeImportJob(status: ImportJobStatus): boolean {
  return status === "paused";
}

export function canCancelImportJob(status: ImportJobStatus): boolean {
  return status === "running" || status === "paused";
}

export function isActiveImportJob(status: ImportJobStatus): boolean {
  return status === "running" || status === "paused";
}

export function isImportJobStale(
  status: ImportJobStatus,
  heartbeatAt: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (status !== "running" || !heartbeatAt) return false;
  const at = new Date(heartbeatAt).getTime();
  if (Number.isNaN(at)) return false;
  return nowMs - at > IMPORT_JOB_STALE_MS;
}

export function nextImportJobStatus(
  status: ImportJobStatus,
  action: ImportJobAction,
): ImportJobStatus | null {
  if (action === "pause" && canPauseImportJob(status)) return "paused";
  if (action === "resume" && canResumeImportJob(status)) return "running";
  if (action === "cancel" && canCancelImportJob(status)) return "cancelled";
  if (action === "finish" && status === "running") return "applied";
  if (action === "fail" && status === "running") return "failed";
  return null;
}

export function importJobProgress(readyCount: number, remainingCount: number): {
  done: number;
  total: number;
} {
  const total = Math.max(0, readyCount);
  const remaining = Math.min(total, Math.max(0, remainingCount));
  return { done: total - remaining, total };
}
