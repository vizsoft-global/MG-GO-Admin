export const COMPLIANCE_METRIC_KEYS = [
  "invalid_days",
  "rejected_orders",
  "cancelled_orders",
] as const;

export type ComplianceMetricKey = (typeof COMPLIANCE_METRIC_KEYS)[number];

export type ComplianceRowStatus =
  | "ok"
  | "unknown_id"
  | "ambiguous"
  | "invalid_day"
  | "invalid_number"
  | "duplicate";

export type ComplianceUploadRow = {
  row_index: number;
  employee_id: string;
  driver_code: string;
  day: string;
  invalid_days: number;
  rejected_orders: number;
  cancelled_orders: number;
  status: ComplianceRowStatus;
};

/** Raw sheet as the browser sends it. Cells are untrusted strings. */
export type ComplianceSheet = {
  headers: string[];
  rows: string[][];
};

export type ComplianceSheetIssues = {
  /** Non-empty ⇒ the file must not be applied. */
  missingRequiredColumns: string[];
  /** Recorded and shown; absent metrics count as zero. */
  missingOptionalColumns: string[];
};

/** One document to write, already keyed and shaped. */
export type ComplianceWrite = {
  id: string;
  data: Record<string, unknown>;
};

/** One live rider indexed by both identities. */
export type CompliancePreviewRow = ComplianceUploadRow & {
  driver_id: string | null;
  driver_name: string | null;
};

export type CompliancePreview = {
  rows: CompliancePreviewRow[];
  issues: ComplianceSheetIssues;
  statusCounts: Record<ComplianceRowStatus, number>;
};

export type CompliancePreviewResult =
  | { preview: CompliancePreview }
  | { error: "not_authorized" | "lookup_failed" };

export type ComplianceApplyResult =
  | {
      success: true;
      totalRows: number;
      writtenRows: number;
      driverCount: number;
      notifiedDrivers: number;
      statusCounts: Record<ComplianceRowStatus, number>;
    }
  | {
      error:
        | "not_authorized"
        | "not_configured"
        | "missing_columns"
        | "no_rows"
        | "write_failed"
        | "partial_write";
      /** Populated on `missing_columns`: what the file had to carry. */
      missingRequiredColumns?: string[];
      /** Populated on `partial_write`: rows that committed before the failure. */
      writtenRows?: number;
      driverCount?: number;
      notifiedDrivers?: number;
      statusCounts?: Record<ComplianceRowStatus, number>;
      errorDetail?: string;
    };
