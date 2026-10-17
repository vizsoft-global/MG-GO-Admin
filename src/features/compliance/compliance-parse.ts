import {
  COMPLIANCE_METRIC_KEYS,
  type ComplianceMetricKey,
  type CompliancePreviewRow,
  type ComplianceRowStatus,
  type ComplianceSheet,
  type ComplianceSheetIssues,
  type ComplianceUploadRow,
  type ComplianceWrite,
} from "./types";

/** Ops reconcile the current month; one file beyond this is a mistake, not an upload. */
export const COMPLIANCE_MAX_ROWS = 5000;

/** Firestore caps a WriteBatch at 500; 400 leaves headroom for the audit write. */
export const COMPLIANCE_WRITE_CHUNK = 400;

export const COMPLIANCE_REQUIRED_COLUMNS = ["day"] as const;
export const COMPLIANCE_IDENTITY_COLUMNS = ["employee_id", "driver_code"] as const;
export const COMPLIANCE_OPTIONAL_COLUMNS = COMPLIANCE_METRIC_KEYS;

/** The CSV template, in the order the download writes it. */
export const COMPLIANCE_TEMPLATE_HEADERS = [
  ...COMPLIANCE_IDENTITY_COLUMNS,
  ...COMPLIANCE_REQUIRED_COLUMNS,
  ...COMPLIANCE_OPTIONAL_COLUMNS,
] as const;

const MAX_METRIC: Record<ComplianceMetricKey, number> = {
  invalid_days: 31,
  rejected_orders: 9999,
  cancelled_orders: 9999,
};

/**
 * KeeTa sheets say "Rider ID" / "Order Rejections" where this writer says
 * employee_id / rejected_orders. Applied after space-and-hyphen folding so
 * "Employee ID" still lands on employee_id.
 */
const HEADER_ALIASES: Record<string, string> = {
  rider_id: "employee_id",
  am_id: "employee_id",
  mg_id: "driver_code",
  date: "day",
  order_rejections: "rejected_orders",
  rejections: "rejected_orders",
  cancellations: "cancelled_orders",
  canceled_orders: "cancelled_orders",
};

/**
 * Asia/Kuwait is a fixed +03:00 with no DST, so the day string is arithmetic
 * rather than a timezone database lookup. Mirrors `kuwaitDayString` in
 * functions/src/core/kuwait.ts — the two must agree or the writer and the
 * reader name different documents.
 */
export function kuwaitDayString(nowMs: number = Date.now()): string {
  return new Date(nowMs + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** `2026-10-12` → true. Kuwait day strings are plain dates, never instants. */
export function isComplianceDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeHeader(value: string): string {
  return normalizeCell(value).toLowerCase().replace(/[\s-]+/g, "_");
}

function canonicalHeader(value: string): string {
  const key = normalizeHeader(value);
  return HEADER_ALIASES[key] ?? key;
}

const ZERO_WIDTH = /[\u200B-\u200D\u200E\u200F\u202A-\u202E\uFEFF]/g;
const ARABIC_INDIC = /[\u0660-\u0669\u06F0-\u06F9]/g;

/**
 * Kuwaiti Excel exports arrive with Arabic-Indic digits, and a copy-paste from a
 * chat app arrives with zero-width joiners glued to an id. Both would parse as a
 * non-number or an unknown rider if taken literally, so the server folds them
 * before anything else looks at a cell. This is the only normalisation pass —
 * every reader downstream sees the same string.
 */
export function normalizeCell(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .replace(ZERO_WIDTH, "")
    .replace(ARABIC_INDIC, (digit) => {
      const code = digit.codePointAt(0) ?? 0;
      const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
      return String(code - base);
    })
    .replace(/\u00A0/g, " ")
    .trim();
}

/** A blank cell is a deliberate zero; anything else must parse to a whole number. */
function numberOrNull(value: string): number | null {
  if (value === "") return 0;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function statusOf(input: {
  employee_id: string;
  driver_code: string;
  day: string;
  metrics: Record<ComplianceMetricKey, number>;
  metricsOk: boolean;
  seen: Set<string>;
  today: string;
}): ComplianceRowStatus {
  if (!input.employee_id && !input.driver_code) return "unknown_id";
  if (!isComplianceDay(input.day) || input.day > input.today) return "invalid_day";
  if (!input.metricsOk) return "invalid_number";
  for (const key of COMPLIANCE_METRIC_KEYS) {
    const value = input.metrics[key];
    if (!Number.isInteger(value) || value < 0 || value > MAX_METRIC[key]) {
      return "invalid_number";
    }
  }
  const identity = input.employee_id || input.driver_code;
  if (input.seen.has(`${identity}|${input.day}`)) return "duplicate";
  return "ok";
}

export function parseComplianceSheet(
  sheet: ComplianceSheet,
  options?: { today?: string },
): { rows: ComplianceUploadRow[]; issues: ComplianceSheetIssues } {
  const today = options?.today ?? kuwaitDayString();

  const indexByHeader = new Map<string, number>();
  sheet.headers.forEach((header, index) => {
    const key = canonicalHeader(header);
    if (key && !indexByHeader.has(key)) indexByHeader.set(key, index);
  });

  const missingOptionalColumns = COMPLIANCE_OPTIONAL_COLUMNS.filter(
    (column) => !indexByHeader.has(column),
  ) as string[];
  const missingRequiredColumns: string[] = [];
  if (!indexByHeader.has("day")) missingRequiredColumns.push("day");
  if (!COMPLIANCE_IDENTITY_COLUMNS.some((column) => indexByHeader.has(column))) {
    missingRequiredColumns.push("employee_id or driver_code");
  }

  const seen = new Set<string>();
  const rows = sheet.rows.slice(0, COMPLIANCE_MAX_ROWS).map((cells, rowIndex) => {
    const at = (column: string): string => {
      const index = indexByHeader.get(column);
      return index === undefined ? "" : normalizeCell(cells[index]);
    };

    const parsed: Record<ComplianceMetricKey, number | null> = {
      invalid_days: null,
      rejected_orders: null,
      cancelled_orders: null,
    };
    for (const key of COMPLIANCE_METRIC_KEYS) parsed[key] = numberOrNull(at(key));

    const metricsOk = COMPLIANCE_METRIC_KEYS.every((key) => parsed[key] !== null);
    const metrics = Object.fromEntries(
      COMPLIANCE_METRIC_KEYS.map((key) => [key, parsed[key] ?? 0]),
    ) as Record<ComplianceMetricKey, number>;

    const employeeId = at("employee_id");
    const driverCode = at("driver_code");
    const day = at("day");
    const status = statusOf({
      employee_id: employeeId,
      driver_code: driverCode,
      day,
      metrics,
      metricsOk,
      seen,
      today,
    });
    if (status === "ok") seen.add(`${employeeId || driverCode}|${day}`);

    return {
      row_index: rowIndex,
      employee_id: employeeId,
      driver_code: driverCode,
      day,
      ...metrics,
      status,
    } satisfies ComplianceUploadRow;
  });

  return { rows, issues: { missingRequiredColumns, missingOptionalColumns } };
}

/**
 * Collapse rows that resolve to the same rider-day.
 *
 * The parser can only dedupe on the identity as typed. Two rows — one carrying
 * the AM id, the other the MG id, both belonging to one rider — pass it, and only
 * after resolution is the pair visible. First occurrence wins, so a corrected
 * second row is *rejected* rather than silently winning: an operator who meant to
 * fix a value must re-upload the day, which overwrites it deliberately.
 *
 * Rows the parser already rejected are left exactly as they were.
 */
export function dedupeResolvedRows(rows: CompliancePreviewRow[]): {
  rows: CompliancePreviewRow[];
  duplicateCount: number;
} {
  const seen = new Set<string>();
  let duplicateCount = 0;
  const deduped = rows.map((row) => {
    if (row.status !== "ok" || !row.driver_id) return row;
    const key = `${row.driver_id}|${row.day}`;
    if (seen.has(key)) {
      duplicateCount += 1;
      return { ...row, status: "duplicate" as ComplianceRowStatus };
    }
    seen.add(key);
    return row;
  });
  return { rows: deduped, duplicateCount };
}

/**
 * The single write builder. Both the server action and the emulator check call
 * this, so the document the emulator proves is byte-for-byte the document the
 * action writes — there is no second place the shape can drift.
 *
 * `id` is `{driverId}_{day}`, the key both readers sum. `uploaded_at` is a Date,
 * which the Admin SDK stores as a timestamp.
 */
export function buildComplianceWrites(
  rows: CompliancePreviewRow[],
  meta: { batchId: string; fileName: string; uploadedBy: string; uploadedAt: Date },
): ComplianceWrite[] {
  return rows
    .filter((row) => row.status === "ok" && row.driver_id)
    .map((row) => ({
      id: `${row.driver_id}_${row.day}`,
      data: {
        driver_id: row.driver_id,
        employee_id: row.employee_id || null,
        driver_code: row.driver_code || null,
        day: row.day,
        invalid_days: row.invalid_days,
        rejected_orders: row.rejected_orders,
        cancelled_orders: row.cancelled_orders,
        source: "ops_upload",
        batch_id: meta.batchId,
        file_name: meta.fileName,
        uploaded_by: meta.uploadedBy,
        uploaded_at: meta.uploadedAt,
      },
    }));
}

/**
 * Commit the planned writes in chunks, and report exactly how far it got.
 *
 * The commit function is injected so this ordering rule is testable without a
 * database: a chunk that throws after an earlier chunk committed must leave the
 * earlier chunk counted, because the caller reports that number to an operator who
 * is about to decide whether to re-upload. Getting this wrong is the difference
 * between "nothing was written" and a silent overwrite of half a day's data.
 */
export async function commitComplianceWrites(
  writes: ComplianceWrite[],
  commitChunk: (chunk: ComplianceWrite[]) => Promise<void>,
  chunkSize: number = COMPLIANCE_WRITE_CHUNK,
): Promise<{ committed: ComplianceWrite[]; failure: unknown | null }> {
  const committed: ComplianceWrite[] = [];
  for (let i = 0; i < writes.length; i += chunkSize) {
    const chunk = writes.slice(i, i + chunkSize);
    try {
      await commitChunk(chunk);
      committed.push(...chunk);
    } catch (error) {
      return { committed, failure: error };
    }
  }
  return { committed, failure: null };
}
