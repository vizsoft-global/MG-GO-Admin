import type { DriverImportCredential, DriverImportPreviewRow } from "../types";
import type { DriverImportLogEvent } from "./import-progress";
import type { ImportJobStatus } from "./import-job";

export type DriverImportJobSummary = {
  id: string;
  fileName: string;
  status: ImportJobStatus;
  rowCount: number;
  readyCount: number;
  remainingCount: number;
  appliedCount: number;
  skippedCount: number;
  approvedCount: number;
  failedCount: number;
  uploadedAt: string;
  heartbeatAt: string | null;
  duplicateStrategy: "skip" | "update";
  approveImmediately: boolean;
};

export type DriverImportJobDetail = DriverImportJobSummary & {
  events: DriverImportLogEvent[];
  credentials: DriverImportCredential[];
  failures: Array<{ rowIndex: number; reason: string }>;
  remainingRows: DriverImportPreviewRow[];
};
